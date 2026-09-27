# Room Chart

A seating chart for the classroom, installed to the home screen of an Android tablet and phone. Tap a seat to record a worksheet mark, a positive or negative note, participation, or an absence. Every tap is saved on the device first and synced to one JSON file in the teacher's Google Drive when the connection allows.

- Several named charts per class; tables are objects that move and rotate, and names always stay upright.
- Door view (from the back, board at the top) and board view (from the front).
- Modes: Worksheet (3 · 2 · 1 · 0), Positive, Negative, Participation, Attendance. Absent is in every menu.
- Badges carry a letter or digit as well as a colour. Day summary, attendance history, random picker that skips absent students.
- Edit mode: drag and rotate tables, turn a table around, swap students, add or remove seats and tables; Save, Save as new, or Discard.

## Data

`sample/sample-data.json` holds made-up four-digit codes and no names. No student data is kept in this repository. Real data lives only in the teacher's own Drive file.

Google sign-in uses the `drive.file` scope, so the app can open only the files picked with it.

## Tests

```
node tests/model.test.mjs
node tests/test-server.mjs 8123 <folder with a copy of the sample data>
```

The browser tests (`tests/e2e.mjs`, `tests/sync.mjs`, `tests/touch.mjs` for finger taps) use `playwright-core` with a local Chrome.
