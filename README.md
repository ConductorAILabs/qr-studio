# Conductor QR Code Creator

QR codes that aren't boring — animated, video-backed, or 3D — that still scan.
It runs entirely in the browser: no build step, no backend, nothing uploaded.

Live: https://conductor-qr.netlify.app

## Styles

- **Animated** — the dark squares pulse and sweep (optional rainbow). The finder
  corners stay solid so phones still lock on.
- **Video mask** — a video plays inside the code squares.
- **Video background** — the video fills the background with the code in white on top.
- **3D** — the squares stand up off the board and cast a shadow you can move with a light angle.

Every style encodes whatever URL you type. Export a still **PNG**, or an animated **WebM** / **GIF**.

## Run locally

It's a static site — just serve the `public/` folder:

```bash
cd public
python3 -m http.server 8080
# http://localhost:8080
```

Serve over http rather than opening the file directly, so the GIF worker and
video exports aren't blocked by cross-origin rules.

## Deploy

Any static host works. The included `netlify.toml` publishes `public/` and sets
the security headers (CSP, `X-Frame-Options`, etc.):

```bash
netlify deploy --prod --dir public
```

## Browser support

Animated WebM export needs `MediaRecorder` + `canvas.captureStream` — fine in
Chrome, Firefox and desktop Safari. iPhone Safari doesn't support it, so the app
points those users to GIF instead. PNG and the live preview work everywhere.

## Third-party

Vendored under `public/` (both MIT):

- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) — QR matrix
- [gif.js](https://github.com/jnordberg/gif.js) — GIF encoding

## License

[Creative Commons Attribution 4.0 International (CC BY 4.0)](LICENSE) ©
2026 Conductor AI Labs.

You're free to use, share and adapt this work, including commercially, **as long
as you give appropriate credit**: attribute it to **Conductor AI Labs** with a
link to https://conductorailabs.com/. For apps with a UI, keep that credit
visible to end users (e.g. an About screen, footer, or credits section).
