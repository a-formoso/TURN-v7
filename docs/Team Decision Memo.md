# Team: remove it, finish it, or pause it? (decision memo, 2 October 2026)

> **Decision (2 October 2026): Option C, shown as an upcoming feature.** Team sharing paused (owner 2026-10-02): UI shows Coming soon; backend kept; relaunch plan in docs/Team Decision Memo.md.
> The owner's words: "go with option C. Don't let users interract with it in the frontend. Maybe allow them
> to see it like an upcoming feature". So, unlike section 4 below, nobody but the admin can open the Team
> window, not even a collaborator on a film shared with them: everyone else sees the Team button and the
> phone ⋯ entry as "Team" with a "Soon" chip and the tooltip "Team sharing is coming soon: invite co-writers
> and art directors to work on your film.", and a click opens nothing. Films already shared still open with
> their role ("Shared with me", the read-only rules). Frances's Team entry, the Co-writer line, the landing
> line and the "email not sent" wording were fixed; the Privacy page and the Terms were not touched. Nothing
> in the database or the invite-collaborator source changed. Tests: `scripts/test-team-paused.mjs`.

## 1) What Team is today

Every signed-in user sees a **Team** button on every film. On phones it is in the ⋯ menu. An owner can add someone by email and pick a role: View-only, Co-writer or Art director. Access is granted on the spot. But no invite email is ever sent, because the invite email function was never deployed. Instead the owner gets a red error message that mentions an internal file: "the invite email function isn't deployed yet (see supabase/README.md)" (app/cloud.jsx:517). The invited person is told nothing. They only find the film if they happen to sign up with that exact address.

The parts behind the screen are solid and tested:
- **Roles are enforced.** Each role can only change its own sections, and the database refuses the rest.
- **Removing someone works at once.** They lose access immediately.
- **Films shared with you** show up in a "Shared with me" strip on Home.
- **Billing is already safe.** Whoever clicks Generate pays, from their own credits and within their own plan. The owner's credits are never touched (image-proxy/index.ts:572).

Several things users are told are false:
- Frances says "INVITATIONS ARE REAL EMAILS" (app/ai.jsx:2377).
- The Team panel says "Your subscription includes your seat" (app/team.jsx:170). There are no seats.
- Frances says a Co-writer sees the Art Room read-only (ai.jsx:2382). In fact a Co-writer can't open it at all (app.jsx:3293).
- The Privacy page says your projects are "readable only by your account" (privacy.html:136-137).
- The landing page promises "you can bring your team in" (landing.jsx:146).

Team is not part of any plan, has no limit on collaborators, and earns nothing today.

**What is installed on production.** This is inferred from the repo, not checked:
| Part | Best guess | How sure |
|---|---|---|
| team-collaboration.sql | probably ran | medium-high. fix-new-film-rls.sql repairs a rule that only this file creates. |
| enforce-role-scopes.sql, shared-owners.sql | maybe | low-medium. Tests assume they are live, but there is no dated "ran" note. |
| invitations.sql | unknown | the test fixtures disagree with each other |
| series-production.sql (sharing a whole Show) | **probably not** | medium. See below. |
| storage-readable-folders.sql | probably not | medium. Commit e5d4776 says "not deployed". |
| invite-collaborator function | **not deployed** | known fact |

Two audits disagreed on series-production.sql. I checked the history:
- Commit 03ce812 (26 Sept) says "Production has no series-production.sql".
- Commit 395a0c8 (27 Sept) says it was "Reviewed before its first production run".
- I found no later note saying it ran.

So the promise that one share covers "all existing and future episodes" most likely does not work on production. One read-only query settles every row of this table: `series-production-probe.sql`, run in the Supabase SQL Editor.

## 2) Option A: remove or hide it completely

**What users would notice:** the Team button and the phone menu entry disappear. The invite welcome page is gone. Nothing else changes.

**What changes:**
- **App:** stop showing the Team button (app.jsx:6902). The phone entry follows by itself. Remove the invite welcome page and the "newly shared" notice.
- **Copy:** remove or rewrite the Team entry in Frances's feature list (ai.jsx:2377-2382), the "Shared with me" lines (ai.jsx:2372), and the landing line (landing.jsx:146).
- **Tests:** adjust test-round1-ui and any rebrand tests that pin the Team text.
- **README:** mark the invite function as parked.

**What stays:** the database tables and access rules. Shows, Storage and Cameos depend on them (series-production.sql:103-155). Deleting them would mean rewriting five SQL files and five test suites, with real risk to owners' own file access. Full deletion is about 3-5 days and not recommended.

**Data:** nothing to migrate.
- The owner should first count any live shares, read-only: `select status, role, count(*) from turn_project_members group by 1,2`.
- If shares exist, hiding Team leaves those collaborators with access and the owner with no button to remove them.
- Optionally, with the owner's go-ahead, a small reversible SQL step can end all shares and block new ones.

**Terms and Privacy:** no Terms change. Privacy becomes true again.

**Risks:** low. Stranded shares, if any exist.

**Effort:** S. About 4-8 development hours, plus a 15-minute check by the owner.

## 3) Option B: make it fully working

**Owner steps** (about 2-4 hours, each needs a go-ahead):
- Run the read-only probe.
- Run whatever SQL is missing, in README order, with series-production.sql last.
- On the Mac, after `git pull`, deploy invite-collaborator.
- Add the redirect URLs for kinolot and the legacy hosts.
- Paste branded "Invite user" and "Magic link" email templates. Only the confirm and reset templates exist today.

**Must fix before the invite function goes live** (security):
- **The link address comes from the browser.** The function accepts any web address and builds the email link from it (invite-collaborator/index.ts:82-85). If the Supabase redirect list contains a wildcard, someone could steal another person's sign-in. It should use a fixed list of hosts, like billing-portal does.
- **No limits on sending.** Any signed-in owner, even on a trial, could send unlimited emails from no-reply@infinitestudioai.com and pre-create accounts. Abuse could damage the mail sender that also delivers signup confirmations. It needs a plan requirement and daily caps.
- **It leaks who has an account.** Its answer reveals whether an email address already has one. It should give the same answer either way.

**Database fixes** (about 1 day):
- Today access follows an email address even after the invite is linked to a different account.
- If Supabase's "Confirm email" setting is off, an unconfirmed address also gets access. I could not check that setting.
- The fix must go into every copy of the helper, or a re-run brings the gap back.
- Make live presence private. Today anyone who knows a film's id can see collaborators' emails (cloud.jsx:1970, app.jsx:1034).

**Product fixes:**
- Rooms closed by a role currently say "Director plan" or "Producer plan" (chrome.jsx:293).
- Remove the developer and SQL wording from the panel and toasts.
- Replace the "seat" line.
- Show whether each invitee has joined.
- Add a "Leave film" option.
- Refuse the owner's own email.
- Make a shared film's rooms depend on the collaborator's own plan, not just their role. Today an Art director on Writer or no plan gets the Art Room through a share (app.jsx:3292). The server still charges them and applies their plan's limits, so it costs nothing. But it undercuts the Director upgrade.

**Billing rule:** keep what is built, where each person pays with their own credits. Say it plainly in the panel, the invite page, the Plans window and Frances's list. "Owner pays" would take 2+ weeks and is risky right after the switch.

**Plan entitlements:** which plan gets Team, and how many collaborators per film.

**Legal:** add a "Shared films" clause to the Terms and fix Privacy. The Terms were republished today with a 30-day "updated Terms" banner, so this means another Terms update soon.

**Tests and docs:**
- Add tests for the invite function, the welcome page and the role-and-plan room rules.
- Do a live check with two real accounts.
- Update Frances's feature list in the same change.

**Risks:**
- New attack surface right after the billing launch.
- "Whose credits?" support questions.
- Re-running older SQL can silently undo the Show-aware rules (README:54-74).

**Effort:** L. About 5-7 development days, plus the owner's steps, the owner's decisions and approval of the legal text.

## 4) Option C: pause new sharing, keep everything else (the middle path)

All three audits support this:
- **Owners can't start new shares.** The Team button shows only on films shared WITH you, or for the admin. Collaborators on existing shares still see their role. The admin can still test.
- **The misleading copy is fixed now.** The landing line changes. Frances's Team entry says sharing new films is paused and films already shared with you still open with your role. The developer wording in the toast goes. The wrong Co-writer line goes.
- **Nothing in the database changes.** Team code, the invite function source and the SQL all stay for a later relaunch.
- **No Terms change.** Privacy is true for every new film.

**Effort:** S. About 4-8 hours, plus the owner's 15-minute share count.

## 5) Recommendation: Option C now. Bring Team back later as a capped paid-plan feature, using the Option B list.

What decides it:
1. **Today Team misleads people.** No emails go out. The owner sees an error that names an internal file. Frances promises emails. The "seat" line and the Privacy page are untrue. Leaving it on is worse than either pausing or finishing it.
2. **Finishing it safely is not small, and the timing is bad.** It needs about a week of work. It means deploying an email-sending function that has to be hardened first. It also needs uncertain production SQL, a new Terms clause and a "who pays" message, all in the week billing switched. Meanwhile there are 11 accounts, the only subscriber was your own test (docs/Billing Rollout Runbook.md:5), no plan sells Team, and nothing in the repo shows anyone asking for it.
3. **Pausing is cheap and keeps the hard work.** The database access rules and the "whoever generates pays" billing are already correct and tested. Relaunching later is mostly invites, copy, caps and legal text, not a rebuild.

**Your decisions to proceed:**
1. Choose C, A or B.
2. Run two read-only checks in the Supabase SQL Editor:
   - the share count above;
   - `series-production-probe.sql`.
3. If live shares exist, choose: keep them (C keeps them working), or end them and tell those owners.
4. Approve the new wording for Frances's Team entry and the landing line.
5. For a later relaunch:
   - which plan includes Team (suggested: Producer, or Director and up);
   - a collaborator cap per film (suggested 3-5);
   - confirm "each person pays with their own credits";
   - whether an Art director should get the Stage;
   - whether a collaborator needs their own plan to open the Art Room or Stage on a shared film.

**Not verified:** whether any shares exist on production; which team SQL files actually ran; Supabase's "Confirm email" setting, redirect list and Realtime settings.

The audit made no code changes.