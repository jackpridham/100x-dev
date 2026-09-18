// ThreadCopy - Content Script
// Supports X (Twitter), LinkedIn, and Reddit

(function() {
  'use strict';

  // Detect current platform
  function detectPlatform() {
    const hostname = window.location.hostname;
    if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
      return 'twitter';
    } else if (hostname.includes('linkedin.com')) {
      return 'linkedin';
    } else if (hostname.includes('reddit.com')) {
      return 'reddit';
    }
    return null;
  }

  // Check if we're on a thread/post page
  function isThreadPage() {
    const platform = detectPlatform();
    const path = window.location.pathname;

    switch (platform) {
      case 'twitter':
        // Twitter/X thread: /username/status/id
        return /^\/[^/]+\/status\/\d+/.test(path);
      
      case 'linkedin':
        // LinkedIn post: /feed/update/ or /posts/ or /activity/
        return path.includes('/feed/update/') ||
               path.includes('/posts/') ||
               path.includes('/pulse/') ||
               path.includes('/activity/');
      
      case 'reddit':
        // Reddit thread: /r/subreddit/comments/
        return path.includes('/comments/');
      
      default:
        return false;
    }
  }

  // Check if current LinkedIn page is a Pulse article (not a regular post)
  function isLinkedInArticle() {
    return window.location.pathname.includes('/pulse/') ||
           !!document.querySelector('.reader-article-content, .reader-content-blocks-container');
  }

  // Extract article content from LinkedIn Pulse
  function extractLinkedInArticle() {
    const posts = [];

    // Get title
    const titleEl = document.querySelector('h1');
    const title = titleEl ? titleEl.textContent.trim() : '';

    // Get author
    let authorName = '';
    const authorSelectors = [
      '.reader-author-info__author-name',
      'a[data-tracking-control-name*="author"]',
      '.article-author',
    ];
    for (const sel of authorSelectors) {
      const el = document.querySelector(sel);
      if (el) { authorName = el.textContent.trim(); break; }
    }

    // Get publish date
    const timeEl = document.querySelector('.reader-author-info__publish-date, time, .article-date');
    const timestamp = timeEl ? timeEl.textContent.trim() : '';

    // Get article body from content blocks
    const contentParts = [];
    const container = document.querySelector('.reader-content-blocks-container');

    if (container) {
      container.querySelectorAll(':scope > *').forEach(el => {
        const tag = el.tagName;
        const text = el.textContent.trim();
        if (!text) return;

        if (tag === 'H1' || tag === 'H2' || tag === 'H3') {
          contentParts.push('\n## ' + text + '\n');
        } else if (tag === 'P') {
          contentParts.push(text);
        } else if (tag === 'UL' || tag === 'OL') {
          const items = [];
          el.querySelectorAll('li').forEach(li => {
            items.push('- ' + li.textContent.trim());
          });
          if (items.length) contentParts.push(items.join('\n'));
        } else if (tag === 'BLOCKQUOTE') {
          contentParts.push('> ' + text);
        } else if (tag === 'PRE' || tag === 'CODE') {
          contentParts.push('```\n' + text + '\n```');
        } else if (text.length > 20) {
          contentParts.push(text);
        }
      });
    }

    // Fallback: try getting text from the reader content area
    if (contentParts.length === 0) {
      const readerContent = document.querySelector('.reader-article-content');
      if (readerContent) {
        const text = readerContent.textContent.trim();
        if (text.length > 100) contentParts.push(text);
      }
    }

    // Get images
    const images = [];
    const imgContainer = container || document.querySelector('.reader-article-content');
    if (imgContainer) {
      imgContainer.querySelectorAll('img').forEach(img => {
        if (img.src && !img.src.includes('avatar') && !img.src.includes('profile') && img.width > 80) {
          images.push(img.src);
        }
      });
    }

    const fullText = title ? title + '\n\n' + contentParts.join('\n\n') : contentParts.join('\n\n');

    if (fullText.length > 0) {
      posts.push({
        index: 1,
        authorName,
        authorHandle: '',
        timestamp,
        text: fullText,
        images,
        isMainPost: true
      });
    }

    return posts;
  }

  // Check if current X page is an article (not a regular tweet/thread)
  function isTwitterArticle() {
    // Check for "Article" label in the page header
    let hasArticleLabel = false;
    document.querySelectorAll('span').forEach(s => {
      if (s.textContent.trim() === 'Article') hasArticleLabel = true;
    });
    if (hasArticleLabel) return true;

    // Check for article-specific DOM elements
    if (document.querySelector('[data-testid="TextColumn"], [data-testid="article"]')) return true;

    // Check if there's a single tweet with no tweetText but has long body content
    const tweets = document.querySelectorAll('article[data-testid="tweet"]');
    const tweetTexts = document.querySelectorAll('[data-testid="tweetText"]');
    if (tweets.length === 1 && tweetTexts.length === 0) return true;

    return false;
  }

  // Auto-scroll to load lazy-loaded content (Reddit only)
  async function scrollToLoadAll(platform) {
    // Only scroll on Reddit — Twitter uses thread-following,
    // LinkedIn loads all comments without scrolling
    if (platform !== 'reddit') return;

    const getCount = () => document.querySelectorAll('.comments-comment-item, [data-testid="comment"], shreddit-comment, .Comment, .comment').length;
    const initialCount = getCount();
    if (initialCount <= 1) return;

    let prevCount = initialCount;
    let stableRounds = 0;

    for (let i = 0; i < 30; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 800));

      const newCount = getCount();
      if (newCount === prevCount) {
        stableRounds++;
        if (stableRounds >= 2) break;
      } else {
        stableRounds = 0;
      }
      prevCount = newCount;
    }

    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 300));
  }

  // Auto-expand truncated content before extraction
  async function expandAllContent(platform) {
    let buttons = [];

    if (platform === 'twitter') {
      // Only click the "Show more" links inside tweet text areas
      buttons = document.querySelectorAll('[data-testid="tweet-text-show-more-link"]');
      // Also find "Show more" text inside tweet text containers only
      document.querySelectorAll('[data-testid="tweetText"] + div [role="button"], [data-testid="tweetText"] [role="link"]').forEach(btn => {
        const text = btn.textContent.trim().toLowerCase();
        if (text === 'show more') {
          buttons = [...buttons, btn];
        }
      });
    } else if (platform === 'linkedin') {
      // Only click "see more" toggles within post/comment text areas
      buttons = document.querySelectorAll(
        'button.feed-shared-inline-show-more-text, ' +
        '.see-more-less-toggle, ' +
        '.feed-shared-text-view__see-more-less-toggle'
      );
      // Find by text content but only inside text containers, not reaction/engagement areas
      document.querySelectorAll('.feed-shared-update-v2__description button, .feed-shared-text-view button, .comments-comment-item button').forEach(btn => {
        const text = btn.textContent.trim().toLowerCase();
        if (text === '…see more' || text === '…more' || text === 'see more') {
          buttons = [...buttons, btn];
        }
      });
    }

    if (buttons.length > 0) {
      buttons.forEach(btn => {
        try { btn.click(); } catch(e) {}
      });
      // Wait for content to expand
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Extract a single tweet's data from a DOM element
  function extractTweetData(tweet) {
    try {
      const userNameEl = tweet.querySelector('[data-testid="User-Name"]');
      let authorName = '';
      let authorHandle = '';

      if (userNameEl) {
        const nameSpan = userNameEl.querySelector('span');
        const handleLink = userNameEl.querySelector('a[href^="/"]');
        authorName = nameSpan ? nameSpan.textContent.trim() : '';
        authorHandle = handleLink ? handleLink.textContent.trim() : '';
      }

      const timeEl = tweet.querySelector('time');
      const timestamp = timeEl ? timeEl.getAttribute('datetime') : '';
      const formattedTime = timestamp ? new Date(timestamp).toLocaleString() : '';

      const textEl = tweet.querySelector('[data-testid="tweetText"]');
      const text = textEl ? textEl.textContent.trim() : '';

      const images = [];
      tweet.querySelectorAll('[data-testid="tweetPhoto"] img').forEach(img => {
        if (img.src && !img.src.includes('emoji')) images.push(img.src);
      });
      tweet.querySelectorAll('[data-testid="videoPlayer"] video').forEach(video => {
        if (video.poster) images.push('[Video] ' + video.poster);
      });

      // Get this tweet's status URL for thread-following
      const statusLink = tweet.querySelector('a[href*="/status/"] time')?.parentElement;
      const statusHref = statusLink ? statusLink.getAttribute('href') : '';

      if (text || images.length > 0) {
        return { authorName, authorHandle, timestamp: formattedTime, text, images, statusHref };
      }
    } catch (e) {
      console.error('Error extracting tweet:', e);
    }
    return null;
  }

  // Extract thread content from Twitter/X.
  //
  // A "thread" = the main tweet plus the author's own consecutive self-replies
  // at the top of the page. The moment a tweet from a DIFFERENT person appears,
  // we've reached the comment/replies section and stop. Without that boundary
  // we'd scoop up the author's scattered one-line replies to commenters, which
  // are NOT part of the thread. We stay on the page and scroll in place — we
  // never navigate away.
  async function extractTwitterThread() {
    const firstTweet = document.querySelector('article[data-testid="tweet"]');
    if (!firstTweet) return [];

    const handleOf = (el) =>
      el?.querySelector('[data-testid="User-Name"] a[href^="/"]')
        ?.textContent?.trim()?.toLowerCase() || '';

    const opHandle = handleOf(firstTweet);

    const seenKeys = new Set();
    const allTweets = [];
    let reachedReplies = false; // flips true once we pass the author's thread

    // Prefer the tweet's own status URL as the dedup key (unique per tweet);
    // fall back to leading text when no link is present.
    const keyFor = (data) => data.statusHref || data.text.substring(0, 100);

    // Walk the currently-rendered tweets in DOM (visual) order. Collect the
    // author's tweets; bail out at the first tweet authored by anyone else.
    function collectContiguous() {
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      for (const tweet of articles) {
        const data = extractTweetData(tweet);
        if (!data) continue;

        const handle = (data.authorHandle || '').toLowerCase();

        // First tweet by someone other than the author = start of replies.
        if (opHandle && handle && handle !== opHandle) {
          reachedReplies = true;
          return;
        }

        const key = keyFor(data);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        allTweets.push(data);
      }
    }

    // Expand any "Show more" links currently in view (inline — no navigation)
    function expandVisible() {
      document.querySelectorAll('[data-testid="tweet-text-show-more-link"]').forEach(btn => {
        try { btn.click(); } catch (e) {}
      });
    }

    expandVisible();
    collectContiguous();

    // Scroll down only far enough to load the rest of the self-thread. Stop the
    // moment we reach the replies section, run dry, or hit the bottom. If the
    // very first pass already hit a reply (standalone tweet), we never scroll.
    const scroller = document.scrollingElement || document.documentElement;
    const startScroll = scroller.scrollTop;
    let lastCount = allTweets.length;
    let stableRounds = 0;

    for (let i = 0; i < 25 && !reachedReplies; i++) {
      scroller.scrollTo(0, scroller.scrollTop + Math.round(window.innerHeight * 0.8));
      await new Promise(r => setTimeout(r, 400));
      expandVisible();
      collectContiguous();

      if (allTweets.length === lastCount) {
        stableRounds++;
        if (stableRounds >= 3) break;
      } else {
        stableRounds = 0;
        lastCount = allTweets.length;
      }

      // Reached the very bottom of the page
      if (scroller.scrollTop + window.innerHeight >= scroller.scrollHeight - 4) break;
    }

    // Restore the reader's original scroll position — no navigation happened
    scroller.scrollTo(0, startScroll);
    await new Promise(r => setTimeout(r, 200));

    // Re-index
    allTweets.forEach((t, i) => { t.index = i + 1; });
    return allTweets;
  }

  // Extract article content from Twitter/X
  function extractTwitterArticle() {
    const posts = [];
    const tweetEl = document.querySelector('article[data-testid="tweet"]');
    if (!tweetEl) return posts;

    // Get author info
    let authorName = '';
    let authorHandle = '';
    let formattedTime = '';

    const userNameEl = tweetEl.querySelector('[data-testid="User-Name"]');
    if (userNameEl) {
      const nameSpan = userNameEl.querySelector('span');
      const handleLink = userNameEl.querySelector('a[href^="/"]');
      authorName = nameSpan ? nameSpan.textContent.trim() : '';
      authorHandle = handleLink ? handleLink.textContent.trim() : '';
    }
    const timeEl = tweetEl.querySelector('time');
    const timestamp = timeEl ? timeEl.getAttribute('datetime') : '';
    formattedTime = timestamp ? new Date(timestamp).toLocaleString() : '';

    // Walk the DOM tree in order to extract headings, text, and code blocks
    const contentParts = [];
    const seen = new Set();

    // Helper: check if a link is an external/content link
    function isContentLink(a) {
      const href = a.href || '';
      const text = a.textContent.trim();
      if (!href || !text || text.length > 100 || text.length < 2) return false;
      if (href.includes('x.com/') || href.includes('twitter.com/')) {
        if (/^https?:\/\/(www\.)?(x|twitter)\.com\/[^/]+\/?$/.test(href)) return false;
        if (href.includes('/status/')) return false;
      }
      return true;
    }

    // Extract inline text from a paragraph block, merging spans and links
    function extractInlineText(node) {
      let result = '';
      node.childNodes.forEach(child => {
        if (child.nodeType === 3) {
          // Direct text node
          result += child.textContent;
        } else if (child.nodeType === 1) {
          const tag = child.tagName;
          // Skip metadata elements inside paragraphs
          const cTestId = child.getAttribute && child.getAttribute('data-testid');
          if (cTestId === 'User-Name' || cTestId === 'app-text-transition-container') return;
          if (child.getAttribute && child.getAttribute('role') === 'group') return;

          if (tag === 'A' && isContentLink(child)) {
            result += child.textContent.trim() + ' (' + child.href + ')';
          } else if (tag === 'BR') {
            result += '\n';
          } else {
            // Recurse into spans, divs that wrap text/links
            result += extractInlineText(child);
          }
        }
      });
      return result;
    }

    // Walk the article at the paragraph/block level
    function walkArticleNode(node) {
      if (!node || !node.tagName) return;
      const tag = node.tagName;

      // Skip metadata areas
      const testId = node.getAttribute('data-testid') || '';
      if (testId === 'User-Name' || testId === 'app-text-transition-container' ||
          testId === 'like' || testId === 'retweet' || testId === 'reply' ||
          testId === 'bookmark' || testId === 'share' ||
          node.getAttribute('role') === 'group') return;

      // Skip engagement/timestamp footer area
      const text = node.textContent.trim();
      if (/^\d+:\d+\s*(AM|PM)/.test(text)) return;
      if (/Views$/.test(text)) return;
      if (/^\d[\d,.]*K?\s*(Relevant|View quotes|Reposts|Likes|Bookmarks|Replies)/.test(text)) return;
      if (/^(Relevant|View quotes)/.test(text)) return;

      // Headings
      if (tag === 'H1' || tag === 'H2' || tag === 'H3') {
        if (text && !seen.has(text)) {
          seen.add(text);
          contentParts.push('\n## ' + text + '\n');
        }
        return;
      }

      // Code blocks
      if (tag === 'PRE') {
        if (text && !seen.has(text)) {
          seen.add(text);
          contentParts.push('\n```\n' + text + '\n```\n');
        }
        return;
      }

      // Lists (UL/OL) — iterate LI children with line breaks
      if (tag === 'UL' || tag === 'OL') {
        const listItems = [];
        node.querySelectorAll(':scope > li').forEach(li => {
          const liText = extractInlineText(li).trim();
          if (liText) listItems.push('- ' + liText);
        });
        if (listItems.length > 0) {
          const listBlock = listItems.join('\n');
          if (!seen.has(listBlock)) {
            seen.add(listBlock);
            contentParts.push(listBlock);
          }
        }
        return;
      }

      // BLOCKQUOTE
      if (tag === 'BLOCKQUOTE') {
        const bqText = extractInlineText(node).trim();
        if (bqText && !seen.has(bqText)) {
          seen.add(bqText);
          contentParts.push(bqText);
        }
        return;
      }

      // DIV or SECTION that contains text content — treat as a paragraph block
      const inlineText = extractInlineText(node).trim();

      // If this block has substantial text, it's a paragraph — add it and don't recurse
      if (inlineText.length > 15 && !seen.has(inlineText)) {
        const hasChildBlocks = node.querySelector('h1, h2, h3, pre, section, ul, ol, blockquote');
        if (!hasChildBlocks) {
          seen.add(inlineText);
          contentParts.push(inlineText);
          return;
        }
      }

      // Recurse children for structural elements
      node.childNodes.forEach(child => {
        if (child.nodeType === 1) walkArticleNode(child);
      });
    }

    walkArticleNode(tweetEl);

    // Get images
    const images = [];
    tweetEl.querySelectorAll('img').forEach(img => {
      if (img.src && !img.src.includes('emoji') && !img.src.includes('profile_images') &&
          !img.src.includes('avatar') && img.width > 80) {
        images.push(img.src);
      }
    });

    const fullText = contentParts.join('\n\n');

    if (fullText.length > 0) {
      posts.push({
        index: 1,
        authorName,
        authorHandle,
        timestamp: formattedTime,
        text: fullText,
        images,
        isMainPost: true
      });
    }

    return posts;
  }

  // Extract thread content from LinkedIn
  function extractLinkedInThread() {
    const posts = [];

    // Helper: find first matching element from multiple selectors
    function q(selectors, parent = document) {
      for (const sel of selectors) {
        const el = parent.querySelector(sel);
        if (el) return el;
      }
      return null;
    }

    // Main post - try multiple selector patterns (LinkedIn changes these frequently)
    const mainPostSelectors = [
      '.feed-shared-update-v2__description',
      '.feed-shared-update-v2__commentary',
      '.feed-shared-text-view',
      '.feed-shared-inline-show-more-text',
      '.update-components-text',
      '[data-ad-preview="message"]',
      '.break-words',
    ];

    const authorSelectors = [
      '.update-components-actor__name',
      '.feed-shared-actor__name',
      'a.app-aware-link span[aria-hidden="true"]',
      '.update-components-actor__title',
    ];

    const handleSelectors = [
      '.update-components-actor__supplementary-actor-info',
      '.update-components-actor__description',
      '.feed-shared-actor__description',
      '.update-components-actor__subtitle',
    ];

    const timeSelectors = [
      '.update-components-actor__sub-description',
      '.feed-shared-actor__sub-description',
      'time',
      'span.update-components-actor__sub-description-link',
    ];

    const mainPost = q(mainPostSelectors);
    const mainAuthor = q(authorSelectors);
    const mainHandle = q(handleSelectors);
    const mainTime = q(timeSelectors);

    if (mainPost) {
      const images = [];
      const imgElements = document.querySelectorAll(
        '.feed-shared-image__image, ' +
        '.update-components-image img, ' +
        '.feed-shared-update-v2__content img, ' +
        '.update-components-linkedin-video__container video'
      );
      imgElements.forEach(img => {
        if (img.src && !img.src.includes('avatar') && !img.src.includes('profile')) {
          images.push(img.src || img.poster);
        }
      });

      posts.push({
        index: 1,
        authorName: mainAuthor ? mainAuthor.textContent.trim().split('\n')[0].trim() : '',
        authorHandle: mainHandle ? mainHandle.textContent.trim() : '',
        timestamp: mainTime ? mainTime.textContent.trim() : '',
        text: mainPost.textContent.trim(),
        images,
        isMainPost: true
      });
    }

    // Fallback: if no main post found, try grabbing all visible text from the post container
    if (posts.length === 0) {
      const postContainer = q([
        '.scaffold-finite-scroll__content',
        '.detail-page',
        'main .feed-shared-update-v2',
        'main [data-urn]',
        'main article',
      ]);

      if (postContainer) {
        // Get the largest text block as the post content
        const allText = postContainer.querySelectorAll('span.break-words, span[dir="ltr"], div[dir="ltr"]');
        let longestText = '';
        allText.forEach(el => {
          const text = el.textContent.trim();
          if (text.length > longestText.length) {
            longestText = text;
          }
        });

        if (longestText) {
          posts.push({
            index: 1,
            authorName: '',
            authorHandle: '',
            timestamp: '',
            text: longestText,
            images: [],
            isMainPost: true
          });
        }
      }
    }

    // Comments - try multiple selector patterns
    const commentSelectors = [
      '.comments-comment-item',
      '.comments-comment-entity',
      'article.comments-comment-item',
      '[data-id][class*="comment"]',
    ];

    let comments = [];
    for (const sel of commentSelectors) {
      comments = document.querySelectorAll(sel);
      if (comments.length > 0) break;
    }

    comments.forEach((comment, index) => {
      try {
        const authorEl = q([
          '.comments-post-meta__name-text',
          '.comments-comment-item__post-meta .hoverable-link-text',
          'a[data-tracking-control-name*="comment"] span[aria-hidden="true"]',
          '.comment-entity-header__name',
        ], comment);

        const textEl = q([
          '.comments-comment-item__main-content',
          '.comments-comment-texteditor',
          '.update-components-text',
          'span.break-words',
          'span[dir="ltr"]',
        ], comment);

        const timeEl = q([
          '.comments-comment-item__timestamp',
          'time',
          '.comment-entity-header__timestamp',
        ], comment);

        if (textEl) {
          posts.push({
            index: index + 2,
            authorName: authorEl ? authorEl.textContent.trim().split('\n')[0].trim() : '',
            authorHandle: '',
            timestamp: timeEl ? timeEl.textContent.trim() : '',
            text: textEl.textContent.trim(),
            images: []
          });
        }
      } catch (e) {
        console.error('Error extracting LinkedIn comment:', e);
      }
    });

    return posts;
  }

  // Extract thread content from Reddit
  function extractRedditThread() {
    const posts = [];
    
    // Try new Reddit first
    let mainPost = document.querySelector('[data-test-id="post-content"]') || 
                   document.querySelector('.Post') ||
                   document.querySelector('[data-testid="post-container"]') ||
                   document.querySelector('shreddit-post');

    // Get main post
    const titleEl = document.querySelector('[data-testid="post-title"]') ||
                    document.querySelector('h1') ||
                    document.querySelector('.Post h1');
    
    const postTextEl = document.querySelector('[data-testid="post-text-content"]') ||
                       document.querySelector('.RichTextJSON-root') ||
                       document.querySelector('[slot="text-body"]') ||
                       document.querySelector('.Post .md');

    const authorEl = document.querySelector('[data-testid="post_author_link"]') ||
                     document.querySelector('.Post a[href^="/user/"]') ||
                     document.querySelector('a[href*="/user/"]');

    const timestampEl = document.querySelector('[data-testid="post_timestamp"]') ||
                        document.querySelector('time') ||
                        document.querySelector('.Post time');

    const title = titleEl ? titleEl.textContent.trim() : '';
    const postText = postTextEl ? postTextEl.textContent.trim() : '';
    const author = authorEl ? authorEl.textContent.trim() : '';
    const timestamp = timestampEl ? timestampEl.textContent.trim() : '';

    // Get post images
    const postImages = [];
    const postImgElements = document.querySelectorAll('[data-testid="post-media"] img, .Post img:not([alt=""])');
    postImgElements.forEach(img => {
      if (img.src && !img.src.includes('icon') && !img.src.includes('avatar')) {
        postImages.push(img.src);
      }
    });

    if (title || postText) {
      posts.push({
        index: 1,
        authorName: author,
        authorHandle: author ? `u/${author.replace('u/', '')}` : '',
        timestamp,
        text: title + (postText ? '\n\n' + postText : ''),
        images: postImages,
        isMainPost: true
      });
    }

    // Get comments - new Reddit
    const commentElements = document.querySelectorAll('[data-testid="comment"], shreddit-comment, .Comment');
    
    commentElements.forEach((comment, index) => {
      try {
        // New Reddit structure
        let commentAuthor = comment.querySelector('[data-testid="comment_author_link"]') ||
                           comment.querySelector('a[href^="/user/"]');
        let commentText = comment.querySelector('[data-testid="comment"] p') ||
                         comment.querySelector('.RichTextJSON-root') ||
                         comment.querySelector('.md');
        let commentTime = comment.querySelector('time') ||
                         comment.querySelector('[data-testid="comment_timestamp"]');

        // Shreddit structure
        if (!commentText && comment.tagName === 'SHREDDIT-COMMENT') {
          commentAuthor = comment.getAttribute('author');
          commentText = comment.querySelector('[slot="comment"]');
          commentTime = comment.querySelector('time');
        }

        const authorText = typeof commentAuthor === 'string' ? commentAuthor : 
                          (commentAuthor ? commentAuthor.textContent.trim() : '');
        const textContent = commentText ? commentText.textContent.trim() : '';
        const timeText = commentTime ? commentTime.textContent.trim() : '';

        if (textContent) {
          posts.push({
            index: index + 2,
            authorName: authorText,
            authorHandle: authorText ? `u/${authorText.replace('u/', '')}` : '',
            timestamp: timeText,
            text: textContent,
            images: []
          });
        }
      } catch (e) {
        console.error('Error extracting Reddit comment:', e);
      }
    });

    // Fallback: Old Reddit
    if (posts.length <= 1) {
      const oldRedditComments = document.querySelectorAll('.comment');
      oldRedditComments.forEach((comment, index) => {
        try {
          const authorEl = comment.querySelector('.author');
          const textEl = comment.querySelector('.md');
          const timeEl = comment.querySelector('time');

          if (textEl) {
            posts.push({
              index: posts.length + 1,
              authorName: authorEl ? authorEl.textContent.trim() : '',
              authorHandle: authorEl ? `u/${authorEl.textContent.trim()}` : '',
              timestamp: timeEl ? timeEl.textContent.trim() : '',
              text: textEl.textContent.trim(),
              images: []
            });
          }
        } catch (e) {
          console.error('Error extracting old Reddit comment:', e);
        }
      });
    }

    return posts;
  }

  // Format posts to plain text
  function formatToPlainText(posts, platform) {
    if (posts.length === 0) {
      return null;
    }

    const platformName = {
      'twitter': 'X (Twitter)',
      'linkedin': 'LinkedIn',
      'reddit': 'Reddit'
    }[platform] || platform;

    let output = `=== Thread from ${platformName} ===\n`;
    output += `URL: ${window.location.href}\n`;
    output += `Copied on: ${new Date().toLocaleString()}\n`;
    output += `${'='.repeat(40)}\n\n`;

    posts.forEach((post, idx) => {
      // Header with author info
      let header = '';
      if (post.authorName || post.authorHandle) {
        header = post.authorName || '';
        if (post.authorHandle && post.authorHandle !== post.authorName) {
          header += header ? ` (${post.authorHandle})` : post.authorHandle;
        }
      }
      
      if (post.isMainPost) {
        output += `[ORIGINAL POST]\n`;
      } else if (idx > 0) {
        output += `[Reply ${idx}]\n`;
      }
      
      if (header) {
        output += `Author: ${header}\n`;
      }
      
      if (post.timestamp) {
        output += `Time: ${post.timestamp}\n`;
      }
      
      output += `---\n`;
      output += `${post.text}\n`;

      // Add images
      if (post.images && post.images.length > 0) {
        output += `\nImages:\n`;
        post.images.forEach((img, i) => {
          output += `  ${i + 1}. ${img}\n`;
        });
      }

      output += `\n${'─'.repeat(40)}\n\n`;
    });

    return output;
  }

  // Copy to clipboard
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        document.body.removeChild(textArea);
        return true;
      } catch (e) {
        document.body.removeChild(textArea);
        return false;
      }
    }
  }

  // Compute the toast's vertical position relative to the button. Place it
  // above the button by default, but flip below when the button is too near
  // the top of the viewport (otherwise the toast is clipped off-screen).
  function computeToastTop(btn) {
    if (!btn) return 'calc(50% - 50px)';
    const rect = btn.getBoundingClientRect();
    const gap = 44; // approx toast height + spacing
    if (rect.top < gap + 8) {
      return (rect.bottom + 8) + 'px'; // not enough room above → below button
    }
    return (rect.top - gap) + 'px';    // above button
  }

  // Show toast notification
  function showToast(message, isError = false) {
    // Remove any existing toast
    const old = document.getElementById('threadcopy-toast');
    if (old) old.remove();

    // Create fresh toast
    const toast = document.createElement('div');
    toast.id = 'threadcopy-toast';
    toast.textContent = message;

    // Position relative to the button (above by default, below if too high)
    const btn = document.getElementById('threadcopy-btn');
    const topPos = computeToastTop(btn);

    // Apply all styles inline to avoid CSS class issues after SPA nav
    toast.style.cssText = `
      position: fixed;
      top: ${topPos};
      right: 24px;
      z-index: 2147483647;
      padding: 12px 20px;
      background: #1a1a2e;
      color: ${isError ? '#f87171' : '#10b981'};
      border: 1px solid ${isError ? 'rgba(248,113,113,0.3)' : 'rgba(16,185,129,0.3)'};
      border-radius: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      font-weight: 500;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      opacity: 0;
      transform: translateY(6px);
      transition: opacity 0.3s ease, transform 0.3s ease;
      pointer-events: none;
    `;

    document.body.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
      });
    });

    // Animate out after 4 seconds
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(6px)';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Create the floating copy button
  function createCopyButton() {
    // Remove existing button if any
    const existingBtn = document.getElementById('threadcopy-btn');
    if (existingBtn) {
      existingBtn.remove();
    }

    const existingToast = document.getElementById('threadcopy-toast');
    if (existingToast) {
      existingToast.remove();
    }

    // Only create button on thread pages
    if (!isThreadPage()) {
      return;
    }

    const button = document.createElement('button');
    button.id = 'threadcopy-btn';
    button.innerHTML = `
      <span class="icon">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
      </span>
      <span class="text">ThreadCopy</span>
    `;

    button.addEventListener('click', async () => {
      const platform = detectPlatform();
      let posts = [];

      // Scroll to load all lazy-loaded tweets, then expand truncated content
      await scrollToLoadAll(platform);
      await expandAllContent(platform);

      switch (platform) {
        case 'twitter':
          posts = isTwitterArticle() ? extractTwitterArticle() : await extractTwitterThread();
          break;
        case 'linkedin':
          posts = isLinkedInArticle() ? extractLinkedInArticle() : extractLinkedInThread();
          break;
        case 'reddit':
          posts = extractRedditThread();
          break;
      }

      const formattedText = formatToPlainText(posts, platform);

      if (!formattedText) {
        showToast('No content found to copy', true);
        return;
      }

      const success = await copyToClipboard(formattedText);

      if (success) {
        // Ensure button exists (recreate if navigation destroyed it)
        if (!document.getElementById('threadcopy-btn')) {
          createCopyButton();
          await new Promise(r => setTimeout(r, 200));
        }

        const btn = document.getElementById('threadcopy-btn');
        if (btn) {
          btn.classList.add('copied');
          const textEl = btn.querySelector('.text');
          if (textEl) textEl.textContent = 'Copied!';
        }

        // Remove any stale toast and create fresh
        const oldToast = document.getElementById('threadcopy-toast');
        if (oldToast) oldToast.remove();

        // Show toast after a beat
        setTimeout(() => {
          showToast(`Copied ${posts.length} post${posts.length > 1 ? 's' : ''} to clipboard`);
        }, 200);

        setTimeout(() => {
          const btn2 = document.getElementById('threadcopy-btn');
          if (btn2) {
            btn2.classList.remove('copied');
            const textEl2 = btn2.querySelector('.text');
            if (textEl2) textEl2.textContent = 'ThreadCopy';
          }
        }, 3000);
      } else {
        showToast('Failed to copy to clipboard', true);
      }
    });

    // --- Draggable behavior ---
    let isDragging = false;
    let dragStartY = 0;
    let btnStartY = 0;
    let hasMoved = false;

    // Restore saved position
    const savedY = localStorage.getItem('threadcopy-btn-y');
    if (savedY !== null) {
      button.style.top = savedY + 'px';
      button.style.transform = 'none';
    }

    button.addEventListener('mousedown', (e) => {
      isDragging = true;
      hasMoved = false;
      dragStartY = e.clientY;
      const rect = button.getBoundingClientRect();
      btnStartY = rect.top;
      button.style.transition = 'background 0.15s';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const deltaY = e.clientY - dragStartY;
      if (Math.abs(deltaY) > 4) hasMoved = true;
      if (!hasMoved) return;

      let newY = btnStartY + deltaY;
      // Clamp within viewport
      newY = Math.max(8, Math.min(window.innerHeight - 52, newY));
      button.style.top = newY + 'px';
      button.style.transform = 'none';
    });

    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      button.style.transition = 'all 0.2s ease';

      if (hasMoved) {
        // Save position
        const rect = button.getBoundingClientRect();
        localStorage.setItem('threadcopy-btn-y', Math.round(rect.top));
      }
    });

    // Override click to ignore if it was a drag
    const origClick = button.onclick;
    button.addEventListener('click', (e) => {
      if (hasMoved) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    }, true);

    // Update toast position to follow button
    const updateToastPos = () => {
      const toast = document.getElementById('threadcopy-toast');
      if (toast) {
        toast.style.top = computeToastTop(button);
      }
    };
    const observer2 = new MutationObserver(updateToastPos);
    observer2.observe(button, { attributes: true, attributeFilter: ['style'] });

    document.body.appendChild(button);
  }

  // Watch for URL changes (SPA navigation)
  let lastUrl = location.href;
  function checkUrlChange() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // Delay to allow page to load
      setTimeout(createCopyButton, 1000);
    }
  }

  // Initialize
  // Toggle: hide/show button based on enabled state
  function hideButton() {
    const btn = document.getElementById('threadcopy-btn');
    if (btn) btn.style.display = 'none';
    const toast = document.getElementById('threadcopy-toast');
    if (toast) toast.style.display = 'none';
  }

  function showButton() {
    const btn = document.getElementById('threadcopy-btn');
    if (btn) {
      btn.style.display = 'flex';
    } else if (isThreadPage()) {
      createCopyButton();
    }
  }

  // Listen for toggle changes from popup via storage
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.threadcopyEnabled) {
      if (changes.threadcopyEnabled.newValue === false) {
        hideButton();
      } else {
        showButton();
      }
    }
  });

  function init() {
    // Check if extension is enabled before creating button
    chrome.storage.sync.get('threadcopyEnabled', (data) => {
      const enabled = data.threadcopyEnabled !== false; // default true
      if (enabled) {
        setTimeout(createCopyButton, 1500);
      }
    });

    // Watch for SPA navigation
    setInterval(checkUrlChange, 500);

    // Also observe DOM changes for dynamic content
    const observer = new MutationObserver((mutations) => {
      // Only re-check if major DOM changes occurred
      const shouldRecheck = mutations.some(m =>
        m.addedNodes.length > 5 ||
        (m.target.tagName === 'MAIN') ||
        (m.target.id && m.target.id.includes('content'))
      );

      if (shouldRecheck && isThreadPage() && !document.getElementById('threadcopy-btn')) {
        // Only show if enabled
        chrome.storage.sync.get('threadcopyEnabled', (data) => {
          if (data.threadcopyEnabled !== false) {
            createCopyButton();
          }
        });
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
