---
name: Post-merge reference refresh
description: The England school reference refresh geocodes over 20,000 postcodes and is too slow for the merge setup hook.
---

The post-merge hook should skip the England school sync and leave it to the scheduled reference-data refresh.

**Why:** A first-time or stale school sync can run for several minutes, exceeding the merge setup timeout and making an otherwise healthy app look broken after a task merge.

**How to apply:** Keep the merge hook fast and non-blocking; use the scheduled refresh for the full school-data rebuild. The application can degrade gracefully when generated reference data is temporarily unavailable.