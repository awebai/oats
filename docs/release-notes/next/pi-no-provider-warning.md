## Fixed

- **A pi home with no provider now says so at spawn and start.** pi starts with no provider, takes its prompt and shows no error, so the home read as running while nothing happened. oats.core 2.12.0 warns and names the fix: log in, set a provider's API key, or pin the soul to another harness. The warning never refuses a start, and a slow or failed check says nothing. A provider set only through a launch configuration's `env` can warn on a pi that does have one.
