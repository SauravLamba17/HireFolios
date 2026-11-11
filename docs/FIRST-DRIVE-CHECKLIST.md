# First drive day checklist

For the admin and HR lead at Simplen. Tick each line.

## A week before

- [ ] Hirefolios installed on the server PC with `install.ps1` (docs/INSTALL.md, steps 2-4); server PC on a UPS.
- [ ] Every PC that will use it finds the server (step 5) and trusts its certificate (step 6): https://simplen.hirefolios.in
      opens with a padlock and no warning.
- [ ] **Settings → Jobs:** each sample job checked, renamed or closed, and saved (the "sample" note disappears).
- [ ] **Settings → Company location:** rename "Main office (sample, rename me)".
- [ ] **Settings → Stages and interview rounds:** the rounds in the right order; interview rounds marked; scorecard criteria per round.
- [ ] **Settings → Reject reasons** and **Average interview time** set.
- [ ] **Settings → How long data is kept:** cooling-off, photo and data periods agreed with management.
- [ ] Privacy notice (English and Hindi) checked by legal and a Hindi speaker; developer bumps the notice version if text changes.
- [ ] **Staff:** accounts for HR, every interviewer and manager, and one **display** account for the lobby TV.
      Everyone has signed in once and set their own password.
- [ ] Backup has run at least once (Server status box shows the time) and the second copy is set up
      (`BACKUP_COPY_DIR`, docs/INSTALL.md step 12).

## The day before

- [ ] **Intake PC:** webcam plugged in. New candidate → go through to the Photo step: the picture shows.
      If there are two webcams, pick the right one in the "Webcam" list (remembered on that PC).
- [ ] Practise one full registration with a staff member as the "candidate" (consent → CV → photo → token).
- [ ] Practise one registration **typed entirely by hand** with no CV and **Upload a photo file instead** (what to do if a
      webcam or scanner fails: manual entry always works).
      Then remove both: **Privacy → Log a request**, kind Erasure, with each mobile, then **Erase now**.
- [ ] **Drive board:** **Add panel** for each room, with the right interviewer and round.
- [ ] Lobby TV: open https://simplen.hirefolios.in on the TV, sign in with the display account,
      press F11 for full screen, turn the chime on. It stays signed in for 30 days.
- [ ] Interviewers know their own sign-in and open **Interview** on their PC.

## On the day, morning

- [ ] Server PC on (no need to sign in to Windows); the Candidates page opens.
- [ ] Server status box: database **Connected**, plenty of free disk.
- [ ] TV shows the waiting screen; interviewers' PCs show their panel.
- [ ] Intake desk: screen can be turned to face the candidate for consent (the candidate reads and taps "I agree").

## During the drive

- Register each walk-in: **+ New candidate** → mobile → details → **turn the screen** for consent → CV (upload files,
  photograph a paper CV, or **Skip CV**) → photo → **Save** → give the token number. Every field can be typed by hand.
- Candidates under 18 are refused by the system; do not collect Aadhaar.
- HR runs the **Drive** board: Assign next, back to waiting, no-show, walked away.
- Interviewers fill the scorecard and choose Pass / Hold / Reject (with a reason).

## End of the day

- [ ] **Drive → End of day**, check the summary.
- [ ] **Export day (Excel)** if management wants the day's list.
- [ ] Selected candidates: record the offer on their profile (offered / accepted / declined, salary, joining date).
- [ ] Leave the server PC on for the 6:15 pm backup (if it was off, the backup runs when it is switched on again).

## After the first week

- [ ] **Reports:** walk-ins, pass rates by round, sources, reject reasons look right.
- [ ] Joined candidates marked as joined on their profile.
- [ ] **Privacy:** any requests from candidates logged and answered before the due date (90 days).
- [ ] Try a restore on a spare PC once (docs/INSTALL.md, steps 2-4 then 13), so you know it works before you need it.
