# Kinolot auth email templates

Paste each file's contents into **Supabase → Authentication → Emails → Templates** (the Message body field),
and set the subject line:

| Template in Supabase | File | Subject |
|---|---|---|
| Confirm signup | confirm-signup.html | Confirm your email for Kinolot |
| Reset Password | reset-password.html | Reset your Kinolot password |
| Invite user | invite.html | You're invited to a film on Kinolot |
| Magic link or OTP | magic-link.html | Your Kinolot sign-in link |
| Change email address | email-change.html | Confirm your new email for Kinolot |
| Password changed (Security notice: **on**) | password-changed.html | Your Kinolot password was changed |
| Email address changed (Security notice: **on**) | email-changed.html | Your Kinolot email address was changed |

The last five went live on 2026-10-02 (owner request), uploaded with the Management API (`PATCH /v1/projects/<ref>/config/auth`,
the `mailer_templates_*_content` / `mailer_subjects_*` / `mailer_notifications_*_enabled` fields) with each file's leading
comment stripped — it names the email vendor, and the comment travels in the email's source. The live subjects of the
first two are Supabase's defaults ("Confirm your email address", "Reset your password"), not the ones in this table.

Where each one is sent from: **Invite user** — `invite-collaborator` for an address with no account (it passes
`invited_project` and `invited_by`, read as `{{ .Data.invited_project }}` / `{{ .Data.invited_by }}`, both optional);
**Magic link** — the same function for an address that already has an account (it can't see the invite, so it stays
neutral); **Password changed** — any password set or change (`cloud.jsx` `cloudSetPassword`, the reset flow);
**Change email** / **Email address changed** — an email change (the app has no screen for it; an admin can change one).
Email confirmation is on (`mailer_autoconfirm: false`, 2026-10-02): the 50-credit trial waits for it.

They are sent through Zoho Transactional Emails (ZeptoMail, EU) from no-reply@infinitestudioai.com as "Kinolot"
(custom SMTP, set in the Supabase dashboard). `{{ .ConfirmationURL }}` and `{{ .Email }}` are Supabase's template
variables — keep them exactly as written. Text colours meet 4.5:1 contrast; the button is the app's amber with its
dark ink. No images (many mail apps block them). Owner request 2026-09-29.
