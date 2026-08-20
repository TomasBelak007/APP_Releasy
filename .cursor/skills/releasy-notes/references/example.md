# Worked examples: raw ticket → business paragraph

These are real before/after pairs from past releases, showing the level of rewriting expected.

---

**Raw ticket (Bug, Czech, informal):**
> zakladam bug místo #9551, ten je označen jako removed nažádost TB: pre messages nedporucujem pouzivat client-calc pretoze sa mi uz par krat stalo ze kalkulacia sice zmenila hodnotu v policku ale policko sa neulozilo do DB - proste pokial sa zmeni policko a dostatocne rychlo sa stlaci save tak sa ulozi predosla hodnota policka.

**Business paragraph:**
> Calculated Values Occasionally Lost on Fast Save. Fixed a timing issue where a value updated by a client-side calculation could be overwritten by the previous value if the record was saved immediately afterward, ensuring calculated values are reliably persisted.

Note what changed: no mention of "#9551", "client-calc", "TB", or any internal jargon. The underlying cause (a save race condition) is kept because it's what a reader needs to trust the fix, but explained in plain terms.

---

**Raw ticket (Feature, English, structured spec):**
> V administraci pribude na detailu uzivatele Auth type => Local application / one-time password (id7)... Po prihlaseni (login/heslo) probehne enrollment => chovani stejne jako Integray/Admin (vygenerujeme secret nebo vlozi vlastni, muze scan QR mobilem, overime jeden OTP a pokracuje do aplikace...)

**Business paragraph:**
> Two-Factor Authentication for Local Logins. Xeelo now supports time-based one-time password (TOTP) two-factor authentication for users who sign in with a local username and password. Users enroll by scanning a QR code or entering a secret, confirm with a one-time code, and can manage or reset their second factor from their account page.

Note: the raw ticket has enrollment-modal button behavior, session validity windows, admin config flags — all implementation detail. The business paragraph keeps only what a reader needs to know: what the feature is, and how a user experiences it.

---

**Raw ticket (Bug, English, customer complaint, real names/companies):**
> Cituji tiket zákazníka: Oprava nečitelného písma v Finance - Úprava blokačních parametrů... Ing. Michal Hornof, PHOENIX lékárenský velkoobchod.

**Business paragraph:**
> Improved Readability on Mobile. Locked, read-only text fields in the Xeelo mobile app were displayed in very light gray text on a gray background, making them hard to read. Text contrast has been corrected across all similar fields.

Note: the customer/company name was dropped here — it didn't add anything a business reader needed. Compare to a case where the name *does* add context, from a real release note:

> External LDAP Authentication Not Working. The External LDAP authentication option was inadvertently removed in a previous release. Because on-premises installations continue to rely on External LDAP and its absence was blocking deployments for customers in Poland, the option has been fully restored.

Here "customers in Poland" explains *why the fix mattered*, so it earns its place. Use judgment case by case — don't default to always including or always dropping names.
