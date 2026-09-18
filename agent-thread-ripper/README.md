# Reddit Thread Ripper - 100x-dev

Chromium to rip reddit/x/linkedin threads.

---

## Features

| Feature | Description |
|---------|-------------|
| **One-Click Copy** | Floating button appears on thread pages—click to copy everything |
| **Smart Detection** | Button only shows on actual threads/posts, not feeds or homepages |
| **Full Metadata** | Captures author names, handles, timestamps, and image URLs |
| **Plain Text Output** | Clean formatting that works in any text editor, notes app, or LLM |

---

## Supported Platforms

### X (Twitter)
- Full thread extraction including all replies
- Author display names and @handles
- Timestamps (converted to local time)
- Image URLs and video thumbnail links
- **URL Pattern**: `x.com/*/status/*` or `twitter.com/*/status/*`

### LinkedIn
- Post content with author details
- All visible comments
- Timestamps and professional titles
- Image attachments
- **URL Pattern**: `linkedin.com/feed/update/*`, `linkedin.com/posts/*`, `linkedin.com/pulse/*`

### Reddit
- Original post (title + body)
- All visible comments with usernames
- Works with both new Reddit and old.reddit.com
- Image and media links
- **URL Pattern**: `reddit.com/r/*/comments/*`

---

## How to Use

1. **Navigate to a thread** on X, LinkedIn, or Reddit
2. **Wait for the button** to appear in the bottom-right corner (takes ~1.5 seconds)
3. **Click "Copy Thread"**
4. **Paste anywhere**—the formatted content is now in your clipboard!

### Example Output

```
=== Thread from X (Twitter) ===
URL: https://x.com/elonmusk/status/1234567890
Copied on: 1/15/2026, 3:45:00 PM
========================================

[ORIGINAL POST]
Author: Elon Musk (@elonmusk)
Time: 1/15/2026, 2:30:00 PM
---
This is an example thread about technology and innovation...

Images:
  1. https://pbs.twimg.com/media/example.jpg

────────────────────────────────────────

[Reply 1]
Author: Tech Enthusiast (@techfan)
Time: 1/15/2026, 2:45:00 PM
---
Great insights! Here's my perspective...

────────────────────────────────────────

[Reply 2]
Author: AI Researcher (@airesearcher)
Time: 1/15/2026, 3:00:00 PM
---
Building on this thread, I'd add that...

────────────────────────────────────────
```

---

