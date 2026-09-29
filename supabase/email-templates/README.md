# Kinolot auth email templates

Paste each file's contents into **Supabase → Authentication → Emails → Templates** (the Message body field),
and set the subject line:

| Template in Supabase | File | Subject |
|---|---|---|
| Confirm signup | confirm-signup.html | Confirm your email for Kinolot |
| Reset Password | reset-password.html | Reset your Kinolot password |

They are sent through Zoho Transactional Emails (ZeptoMail, EU) from no-reply@infinitestudioai.com as "Kinolot"
(custom SMTP, set in the Supabase dashboard). `{{ .ConfirmationURL }}` and `{{ .Email }}` are Supabase's template
variables — keep them exactly as written. Text colours meet 4.5:1 contrast; the button is the app's amber with its
dark ink. No images (many mail apps block them). Owner request 2026-09-29.
