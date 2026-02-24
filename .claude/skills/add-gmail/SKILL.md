---
name: add-gmail
description: "Add Gmail integration for email-based conversations. Creates a Gmail channel that polls for new emails, processes them through the LangGraph graph, and sends responses. Triggers on 'add gmail', 'add email', 'gmail channel', 'email integration'."
---

# Add Gmail Integration

Adds Gmail email support so the LangGraph graph can receive emails, process them, and send email responses. Uses the Google Gmail API with OAuth2 or service account authentication.

## What This Adds

- A `channels/gmail.py` module with Gmail API client for reading and sending emails
- Email polling loop that checks for new messages at configurable intervals
- Thread-aware responses (replies in the same email thread)
- Environment variable configuration for Google API credentials
- Token persistence for OAuth2 flow

## Prerequisites

- A Google Cloud project with the Gmail API enabled
- OAuth2 credentials (client_id and client_secret) or a service account key
- The project must have a compiled graph in `graph.py`
- Python 3.11+

## Parameters / Questions

Ask the user:

1. **Authentication method?**
   - **OAuth2** (default): User grants access via browser consent flow. Best for personal Gmail accounts. Requires `credentials.json` from Google Cloud Console.
   - **Service Account**: For Google Workspace domains with domain-wide delegation. Requires a service account key JSON file.
2. **Poll interval?** (default: 30 seconds)
3. **Should the bot respond to all emails or filter by subject/sender?**
   - Respond to all unread emails
   - Filter by subject prefix (e.g., `[Agent]`)
   - Filter by sender whitelist
4. **Which email address to monitor?** (default: the authenticated account's primary address)

## Workflow

### Step 1: Create the channel module

Create `channels/__init__.py` if it does not exist.

Create `channels/gmail.py`:

```python
"""Gmail channel — polls for new emails and invokes the LangGraph graph."""

import asyncio
import base64
import logging
from email.mime.text import MIMEText
from typing import Any, Dict, List, Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from graph import graph
from config.settings import settings

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/gmail.modify"]


class GmailClient:
    """Client for reading and sending Gmail messages."""

    def __init__(self):
        self.creds: Optional[Credentials] = None
        self.service = None

    def authenticate(self) -> None:
        """Authenticate with Gmail API using OAuth2."""
        import os
        import json

        token_path = settings.gmail_token_path
        credentials_path = settings.gmail_credentials_path

        if os.path.exists(token_path):
            self.creds = Credentials.from_authorized_user_file(token_path, SCOPES)

        if not self.creds or not self.creds.valid:
            if self.creds and self.creds.expired and self.creds.refresh_token:
                self.creds.refresh(Request())
            else:
                if not os.path.exists(credentials_path):
                    raise FileNotFoundError(
                        f"Gmail credentials file not found: {credentials_path}. "
                        "Download it from Google Cloud Console."
                    )
                flow = InstalledAppFlow.from_client_secrets_file(credentials_path, SCOPES)
                self.creds = flow.run_local_server(port=0)

            with open(token_path, "w") as f:
                f.write(self.creds.to_json())

        self.service = build("gmail", "v1", credentials=self.creds)

    def get_unread_messages(self, max_results: int = 10) -> List[Dict[str, Any]]:
        """Fetch unread messages from the inbox."""
        query = "is:unread in:inbox"
        if settings.gmail_subject_filter:
            query += f' subject:"{settings.gmail_subject_filter}"'

        results = (
            self.service.users()
            .messages()
            .list(userId="me", q=query, maxResults=max_results)
            .execute()
        )

        messages = []
        for msg_ref in results.get("messages", []):
            msg = (
                self.service.users()
                .messages()
                .get(userId="me", id=msg_ref["id"], format="full")
                .execute()
            )
            messages.append(msg)

        return messages

    def mark_as_read(self, message_id: str) -> None:
        """Mark a message as read."""
        self.service.users().messages().modify(
            userId="me",
            id=message_id,
            body={"removeLabelIds": ["UNREAD"]},
        ).execute()

    def send_reply(self, to: str, subject: str, body: str, thread_id: str, message_id: str) -> None:
        """Send a reply in the same email thread."""
        message = MIMEText(body)
        message["to"] = to
        message["subject"] = f"Re: {subject}" if not subject.startswith("Re:") else subject
        message["In-Reply-To"] = message_id
        message["References"] = message_id

        raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
        self.service.users().messages().send(
            userId="me",
            body={"raw": raw, "threadId": thread_id},
        ).execute()

    @staticmethod
    def extract_email_content(message: Dict[str, Any]) -> Dict[str, str]:
        """Extract sender, subject, body, and IDs from a Gmail message."""
        headers = {h["name"].lower(): h["value"] for h in message["payload"]["headers"]}
        sender = headers.get("from", "")
        subject = headers.get("subject", "")
        message_id = headers.get("message-id", "")
        thread_id = message.get("threadId", "")

        # Extract body
        body = ""
        payload = message["payload"]
        if "body" in payload and payload["body"].get("data"):
            body = base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", errors="replace")
        elif "parts" in payload:
            for part in payload["parts"]:
                if part["mimeType"] == "text/plain" and part["body"].get("data"):
                    body = base64.urlsafe_b64decode(part["body"]["data"]).decode("utf-8", errors="replace")
                    break

        return {
            "sender": sender,
            "subject": subject,
            "body": body.strip(),
            "message_id": message_id,
            "thread_id": thread_id,
            "gmail_id": message["id"],
        }


async def poll_gmail(client: GmailClient) -> None:
    """Continuously poll Gmail for new messages and process them."""
    interval = settings.gmail_poll_interval

    logger.info(f"Gmail polling started (interval: {interval}s)")

    while True:
        try:
            messages = client.get_unread_messages()

            for msg in messages:
                email_data = GmailClient.extract_email_content(msg)

                if not email_data["body"]:
                    client.mark_as_read(email_data["gmail_id"])
                    continue

                session_id = f"gmail:{email_data['thread_id']}"
                logger.info(f"Processing email from {email_data['sender']}: {email_data['subject']}")

                try:
                    result = await graph.ainvoke(
                        {
                            "messages": [{"role": "user", "content": email_data["body"]}],
                            "session_id": session_id,
                            "metadata": {
                                "channel": "gmail",
                                "sender": email_data["sender"],
                                "subject": email_data["subject"],
                                "thread_id": email_data["thread_id"],
                            },
                        }
                    )

                    if result.get("messages"):
                        last_message = result["messages"][-1]
                        response_text = (
                            last_message.content
                            if hasattr(last_message, "content")
                            else str(last_message)
                        )

                        client.send_reply(
                            to=email_data["sender"],
                            subject=email_data["subject"],
                            body=response_text,
                            thread_id=email_data["thread_id"],
                            message_id=email_data["message_id"],
                        )

                except Exception:
                    logger.exception(f"Error processing email {email_data['gmail_id']}")

                finally:
                    client.mark_as_read(email_data["gmail_id"])

        except Exception:
            logger.exception("Error polling Gmail")

        await asyncio.sleep(interval)
```

### Step 2: Update settings

Add to `config/settings.py` in the `Settings` class:

```python
    # Gmail
    gmail_credentials_path: str = "credentials.json"
    gmail_token_path: str = "token.json"
    gmail_poll_interval: int = 30
    gmail_subject_filter: str = ""  # Optional: only process emails with this subject prefix
```

### Step 3: Update main.py

Add Gmail polling to the main function:

```python
import asyncio
from channels.gmail import GmailClient, poll_gmail

async def main():
    """Run the LangGraph system with Gmail polling."""
    gmail_client = GmailClient()
    gmail_client.authenticate()

    print("Gmail channel started. Polling for new emails...")

    await poll_gmail(gmail_client)
```

**If other services are already running**, use `asyncio.gather()`:

```python
async def main():
    gmail_client = GmailClient()
    gmail_client.authenticate()

    async with asyncio.TaskGroup() as tg:
        tg.create_task(poll_gmail(gmail_client))
        # tg.create_task(other_service())
```

### Step 4: Update .env.example

Append:

```
# Gmail
# Download credentials.json from Google Cloud Console > APIs & Services > Credentials
GMAIL_CREDENTIALS_PATH=credentials.json
GMAIL_TOKEN_PATH=token.json
GMAIL_POLL_INTERVAL=30
# GMAIL_SUBJECT_FILTER=[Agent]
```

### Step 5: Update pyproject.toml

Add these to the `dependencies` list:

```
"google-api-python-client>=2.100.0",
"google-auth-httplib2>=0.2.0",
"google-auth-oauthlib>=1.2.0",
```

### Step 6: Update .gitignore

Add entries to prevent committing credentials:

```
token.json
credentials.json
```

### Step 7: Install dependencies

```bash
pip install -e .
```

## Files Created

| File | Purpose |
|------|---------|
| `channels/__init__.py` | Package init (if not existing) |
| `channels/gmail.py` | Gmail API client, polling loop, email processing |

## Files Modified

| File | Change |
|------|--------|
| `config/settings.py` | Add Gmail settings fields |
| `main.py` | Add Gmail polling startup |
| `.env.example` | Add Gmail configuration variables |
| `pyproject.toml` | Add Google API client dependencies |
| `.gitignore` | Add `token.json` and `credentials.json` |

## Example

User: "Add Gmail so my agent can respond to emails"

1. Ask about OAuth2 vs. service account
2. Ask about poll interval and filters
3. Create `channels/gmail.py` with Gmail client and polling loop
4. Add settings and environment variables
5. Update `main.py` to authenticate and start polling
6. Tell the user:
   - "Go to Google Cloud Console, create a project, enable the Gmail API"
   - "Create OAuth2 credentials (Desktop app type)"
   - "Download `credentials.json` and place it in the project root"
   - "Run `python main.py` -- it will open a browser for OAuth consent on first run"
   - "After granting access, `token.json` will be saved for future runs"

## Verification

After setup, the user should:
1. Place `credentials.json` in the project root
2. Run `python main.py` and complete the OAuth consent in the browser
3. Send an email to the authenticated Gmail account
4. Verify the agent processes the email and sends a reply in the same thread
