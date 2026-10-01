# Room Chart

A seating chart for the classroom, installed to the home screen of an Android tablet and phone. Tap a seat to record a worksheet mark, a positive or negative note, participation, or an absence. Every tap is saved on the device first and synced to one JSON file in the teacher's Google Drive when the connection allows.

- Several named charts per class; tables are objects that move and rotate, and names always stay upright.
- Door view (from the back, board at the top) and board view (from the front).
- Modes: Worksheet (5 · 4 · 3 · 2 · 1 · 0, completion in fifths), Positive, Negative, Participation, Attendance. Absent is in every menu.
- Worksheet completion belongs to the lesson: a lesson that runs over several days opens with each student's latest value from an earlier day (flagged until changed), per class. The first Worksheet tap with no lesson for the day asks for one from a short list: the two most recent lessons, the planned ones, or a new name.
- Badges carry a letter or digit as well as a colour. Day summary and attendance history list the class in roster order, whichever chart is open. A large "Pick a student" button picks a random student and skips absent ones.
- Controls on top when the screen is upright and in a column on the left when it is sideways (or fixed either way in Settings); a tab on their edge hides them so the chart fills the screen.
- Edit mode: drag and rotate tables, turn a table around, swap students, add or remove seats and tables; Save, Save as new, or Discard.

## Data

`sample/sample-data.json` holds made-up four-digit codes and no names. No student data is kept in this repository. Real data lives only in the teacher's own Drive file.

Google sign-in uses the `drive.file` scope, so the app can open only the files picked with it.

## Tests

```
node tests/model.test.mjs
node tests/test-server.mjs 8123 <folder with a copy of the sample data>
```

The browser tests (`tests/e2e.mjs`, `tests/sync.mjs`, `tests/touch.mjs` for finger taps, `tests/dupes.mjs` for two devices marking the same student, `tests/scale.mjs` for the worksheet levels, `tests/signin.mjs` for quiet sign-in renewal, `tests/layout.mjs` for the controls on top or on the left, the tab that hides them and the Pick button, `tests/lessons.mjs` for the lesson list and carry-over of worksheet completion, `tests/daylist.mjs` for the order of the day summary and attendance history) use `playwright-core` with a local Chrome.
