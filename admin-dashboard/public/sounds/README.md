# Notification sound files

The Socket.IO client (`src/hooks/useSocket.js`) plays these on receive:

- `new-order.mp3` — fired for the `order:new` socket event
- `payment-received.mp3` — fired for the `payment:received` socket event

These files are intentionally NOT committed (gitignored). Drop your own
short notification sounds at these paths to enable audio cues.

Recommendations:
- Keep under 1 second (notifications, not jingles)
- Royalty-free (Mixkit, Freesound, or commission your own)
- Volume normalized — the hook plays at 0.5 (50%) but the source clip
  should not be peaking

If the files are missing, `playSound()` swallows the error silently —
the rest of the notification (toast + dropdown entry) still works.
