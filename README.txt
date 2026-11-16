DAILY ACTIVITY TRACKER — how to use

Daily update
  Open index.html and replace only the block between the "DAILY DATA" markers.

Themes
  Green mode is the default. The header button switches to light mode, and the browser remembers the choice.

Installing as an app
  The site must be served over HTTPS (any normal web host, GitHub Pages, Netlify, etc.).
  Open it in Chrome and press the gold "Install app" button in the header,
  or use the install icon in the address bar.
  On iPhone, use Safari: Share > Add to Home Screen.

Changing the app icon
  Put your square icon image (PNG/JPG, 512px or larger) anywhere, then run:
    python3 tools/make-icons.py path/to/icon.png
  Then change VERSION in sw.js (e.g. tracker-v2) so installed copies pick it up.

Intro video (splash screen) - updated with the upscaled clip, watermark removed
  assets/splash/ holds a 6-second clip made from your waterfall video (upscaled to 720x1050, no sound).
  It plays once per visit; tap anywhere or press Skip to close it. Reloads and the Refresh button skip it.
  Chrome uses splash.webm (0.4 MB); other browsers use splash.mp4 (0.9 MB). The video is never
  downloaded again within the same visit, and with "Data saver" on, only the still image shows.
