"""
Email notification module using Resend HTTP API.
Sends notification emails when gift uploads are ready for claiming.
"""

import os

import httpx

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
BASE_URL = os.getenv("BASE_URL", "https://ownyourposts.com")


async def send_ready_email(
    to_email: str,
    claim_token: str,
    ig_handle: str,
    post_count: int,
) -> bool:
    """Send an email notifying the user their content is ready to claim.

    Returns True if sent successfully, False otherwise.
    """
    if not RESEND_API_KEY:
        print(f"[Email] RESEND_API_KEY not set, skipping email to {to_email}")
        return False

    claim_url = f"{BASE_URL}/gift-claim/{ig_handle}/{claim_token}"

    subject = f"Your {post_count} post{'s are' if post_count != 1 else ' is'} ready to claim"

    html_body = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
  <h2 style="margin-bottom: 8px;">Your content is ready</h2>
  <p style="color: #666; font-size: 15px; line-height: 1.5;">
    We've finished uploading {post_count} post{'s' if post_count != 1 else ''} from <strong>@{ig_handle}</strong> to Blossom.
    Click below to generate your Nostr keys and publish.
  </p>
  <a href="{claim_url}"
     style="display: inline-block; margin: 24px 0; padding: 14px 28px; background: linear-gradient(135deg, #8B5CF6, #6D28D9); color: white; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 15px;">
    Claim My Posts
  </a>
  <p style="color: #999; font-size: 13px; line-height: 1.5;">
    Or copy this link:<br>
    <a href="{claim_url}" style="color: #8B5CF6; word-break: break-all;">{claim_url}</a>
  </p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
  <p style="color: #999; font-size: 12px;">
    Sent by <a href="{BASE_URL}" style="color: #8B5CF6;">Own Your Posts</a>. You received this because you entered your email during migration.
  </p>
</body>
</html>"""

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {RESEND_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": "Own Your Posts <notify@ownyourposts.com>",
                    "to": [to_email],
                    "subject": subject,
                    "html": html_body,
                },
            )

            if response.status_code in (200, 201):
                print(f"[Email] Sent notification to {to_email} for @{ig_handle}")
                return True
            else:
                print(f"[Email] Failed to send to {to_email}: {response.status_code} {response.text}")
                return False

    except Exception as e:
        print(f"[Email] Error sending to {to_email}: {e}")
        return False
