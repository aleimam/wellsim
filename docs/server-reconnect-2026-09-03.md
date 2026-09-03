# Server reconnect — request to the second authorised machine

**Date:** 3 September 2026
**From:** the primary WellSim workstation (`D:\TheSimplestNode`), working local-only
**To:** the machine that holds the `wellsim-ops-2026-09-02` SSH identity
**Runs on:** Claude Code or Codex, unchanged. Every step is plain shell.

---

## 0. How an agent should use this file

You are being asked to **re-establish and prove** administrative access to the
WellSim production VPS, which the primary workstation cannot reach. Work
through the parts in order.

- **Part A is read-only.** Run it fully. Nothing in it changes the server.
- **Part B is the report.** Fill it in and send it back. This is the actual
  deliverable — the primary workstation is blind until it arrives.
- **Parts C and D are gated.** Each begins with a STOP. Do not start one
  because the previous part succeeded; wait for a human to say go.

Rules that hold for every part:

1. **Never send the private key anywhere.** Not to the primary workstation, not
   into a chat, not into this repository, not into a paste bin. Your machine
   holds it; your machine runs the commands. That is the whole design.
2. **Never print secret values.** Read environment *names* if you need them,
   never their contents. Do not print `users.json`, case files, tokens or key
   material. Report counts, sizes and checksums instead.
3. **This file lives in a PUBLIC repository** (`github.com/aleimam/wellsim`).
   Nothing secret may be added to it, and nothing secret may go into your
   report. The host address and fingerprints below are already published in
   `docs/deploy.md`; repeating them here adds no new exposure.
4. **Do not deploy anything in Part A or B.** A green connection is not
   authorisation to release.
5. If a command fails, **report the failure verbatim** rather than working
   around it. A worked-around failure is a fact the other machine never learns.

---

## 1. Why this request exists

On 2 September the `wellsim_hetzner` / `wellsim-deploy` key was **retired**, and
the server now rejects it. The replacement is an Ed25519 identity
(`wellsim-ops-2026-09-02`) installed that day through the Hetzner console. **It
was never copied to the primary workstation.**

The consequence: since 2 September the primary workstation has been unable to
reach production at all. It has continued working locally — 43 commits now sit
on `merge/gas-forecast-into-v2` that exist **only** in that working tree and on
two USB drives. Nothing is pushed. Nothing is deployed.

What we need from you is, in order: proof the key still works, an honest health
report, and a fresh off-box copy of `data/`. Deployment is a separate decision
and is **not** being requested today.

---

## 2. Facts you will need

| | |
|---|---|
| Host | Hetzner VPS `wellsim`, **91.98.23.255**, Ubuntu 24.04 LTS |
| Login | `root`, **SSH key only** — password auth is disabled and must stay disabled |
| Identity | `wellsim-ops-2026-09-02` (Ed25519). Substitute its real path for `$KEY` below |
| App path | `/opt/wellsim/app`, owned by the `wellsim` service user |
| Services | `wellsim.service` (PORT=3355), `caddy.service`, `wellsim-backup.timer` (02:30 UTC) |
| Firewall | ufw — OpenSSH, 80/tcp, 443/tcp only |
| Also hosted | `thepwf.net`, static, same Caddy, `/opt/thepwf` — do not disturb it |
| Production runs | branch `codex/v2-foundation`, containment release `6807e738f93119d8459a688ea92894f3831f2d9b` |

**Host key fingerprints — compare on first connection from your machine:**

```
ED25519  SHA256:bkTKZB/FixF9hI99Mp+634XNa/3Ohud4AK9kdl6ntI0
RSA      SHA256:tHM+HmqYYOUok++pJ+bx9WgAzsZZ6HAKWIesnhxc0hg
```

If what you are shown does not match one of these, **stop and report it**. Do
not type `yes`. A mismatch is either a rebuilt host or something worse, and
either way it is a decision for a human, not a prompt to click through.

Set this once per shell:

```bash
KEY=~/.ssh/wellsim-ops-2026-09-02      # <-- correct this to the real path
HOST=root@91.98.23.255
```

---

## Part A — Prove the connection (read-only, run all of it)

### A1. The key is accepted

```bash
ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes "$HOST" 'echo CONNECTED; hostname; uptime'
```

`BatchMode=yes` makes it fail fast rather than sit at a password prompt — and
since password auth is disabled server-side, a prompt would mean something has
changed.

### A2. Services and disk

```bash
ssh -i "$KEY" -o IdentitiesOnly=yes "$HOST" '
  for s in wellsim caddy wellsim-backup.timer; do
    printf "%-24s %s / %s\n" "$s" "$(systemctl is-active $s)" "$(systemctl is-enabled $s 2>/dev/null)"
  done
  echo "--- disk ---"; df -h / | tail -1
  echo "--- memory ---"; free -m | head -2
  echo "--- last boot ---"; who -b
'
```

### A3. SSH hardening is still in force

Confirms nobody loosened access while we were locked out:

```bash
ssh -i "$KEY" -o IdentitiesOnly=yes "$HOST" '
  sshd -T 2>/dev/null | grep -E "^(pubkeyauthentication|passwordauthentication|kbdinteractiveauthentication|permitrootlogin|strictmodes)"
  echo "--- permissions (expect 700 700 600) ---"
  stat -c "%a %n" /root /root/.ssh /root/.ssh/authorized_keys
  echo "--- authorised keys: COUNT AND COMMENTS ONLY, never the key bodies ---"
  awk "{print NR\": \"\$1\" ...\" \$3}" /root/.ssh/authorized_keys
'
```

Expected: `pubkeyauthentication yes`, `passwordauthentication no`,
`kbdinteractiveauthentication no`, `permitrootlogin prohibit-password`,
`strictmodes yes`. **Report any key you do not recognise.**

### A4. The containment release is still what is deployed

```bash
ssh -i "$KEY" -o IdentitiesOnly=yes "$HOST" '
  echo "--- the legacy store switch must NOT be set ---"
  systemctl show wellsim -p Environment | tr " " "\n" | sed "s/=.*/=<hidden>/"
  echo "--- firewall ---"; ufw status | head -8
'
curl -s https://wellsim.app/api/accounts/status
echo
curl -s -o /dev/null -w 'wellsim.app  %{http_code}\n' https://wellsim.app/
curl -s -o /dev/null -w 'thepwf.net   %{http_code}\n' https://thepwf.net/
curl -s https://wellsim.app/ | grep -o 'app\.js?v=[0-9a-z-]*'
```

Expected: `accounts/status` reports `"enabled": false` and
`"registrationEnabled": false`; both sites 200; asset stamp `2026-09-02a`
(that is the containment release's stamp — a *different* stamp means something
was deployed since, which we need to know about).

### A5. Backups are running and how far behind they are

```bash
ssh -i "$KEY" -o IdentitiesOnly=yes "$HOST" '
  echo "--- on-box archives (same disk, newest last) ---"
  ls -lt /var/backups/wellsim | head -6
  echo "--- timer ---"; systemctl list-timers wellsim-backup.timer --no-pager | head -3
  echo "--- live data: COUNTS AND SIZES ONLY, no contents ---"
  find /opt/wellsim/app/data -type f | wc -l
  du -sh /opt/wellsim/app/data
  node -e "const u=require(\"/opt/wellsim/app/data/users.json\");console.log(\"accounts:\",Array.isArray(u)?u.length:Object.keys(u).length)"
'
```

The account and case counts matter: the primary workstation's newest server
snapshot is from **1 September** and records **4 accounts and 8 saved cases**.
If the live numbers differ, production has changed since, and the local copy is
stale in a way that affects the recovery point.

---

## Part B — The report (this is the deliverable)

Fill this in and send it back. Say "FAILED" where something failed and paste
the error; do not tidy it up.

```
SERVER RECONNECT REPORT — <date/time, timezone>
Run by: <machine / operator>

A1 key accepted ............ YES / NO      hostname: ......  uptime: ......
   host key matched the published fingerprint? ED25519 / RSA / NO MATCH

A2 wellsim.service ......... active? ......  enabled? ......
   caddy.service ........... active? ......  enabled? ......
   wellsim-backup.timer .... active? ......  enabled? ......
   disk used/avail ......... ......
   last boot ............... ......

A3 passwordauthentication .. ......  (must be "no")
   permitrootlogin ......... ......
   /root /.ssh /authorized_keys perms ... ......
   authorised keys count ... ......   any UNRECOGNISED? ......

A4 accounts/status ......... enabled=......  registrationEnabled=......
   wellsim.app ............. HTTP ......     thepwf.net ... HTTP ......
   asset stamp ............. ......  (expected 2026-09-02a)
   WELLSIM_ENABLE_LEGACY_CASE_STORE present in service env? YES / NO
                                              (it must be NO)

A5 newest on-box archive ... <name> <date> <size>
   timer next run .......... ......
   live data file count .... ......   total size ... ......
   accounts ................ ......   (1 Sep snapshot had 4)
   saved cases ............. ......   (1 Sep snapshot had 8)

ANYTHING UNEXPECTED, in your own words:
  ......
```

---

## Part C — Fresh off-box data pull

> **STOP.** Only start Part C once Part B has been sent and a human has said to
> proceed. If Part A found anything unexpected, that is resolved first.

The primary workstation's newest copy of production `data/` is from 1 September.
This closes that gap.

```bash
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
ssh -i "$KEY" -o IdentitiesOnly=yes "$HOST" 'tar -czf - -C /opt/wellsim/app data' \
  > "wellsim-data-$STAMP.tar.gz"
sha256sum "wellsim-data-$STAMP.tar.gz"
tar -tzf "wellsim-data-$STAMP.tar.gz" | wc -l
```

Then, **without extracting over anything live**, prove the archive is restorable:

```bash
mkdir -p /tmp/restore-check && tar -xzf "wellsim-data-$STAMP.tar.gz" -C /tmp/restore-check
find /tmp/restore-check -type f | wc -l
node -e "JSON.parse(require('fs').readFileSync('/tmp/restore-check/data/users.json','utf8'));console.log('users.json parses')"
rm -rf /tmp/restore-check
```

Report the **filename, byte size, SHA-256 and entry count**. Do not report the
contents.

**Before this archive travels anywhere**, encrypt it — it contains salted
password hashes and customer engineering cases:

```bash
# AES-256-GCM, passphrase from the password manager, never typed into a chat
openssl enc -aes-256-gcm -pbkdf2 -iter 600000 -salt \
  -in "wellsim-data-$STAMP.tar.gz" -out "wellsim-data-$STAMP.tar.gz.enc"
sha256sum "wellsim-data-$STAMP.tar.gz.enc"
```

Send the `.enc` file and its checksum. Send the passphrase **by a different
channel**, or better, use one already shared in the password manager.

---

## Part D — The deployment question (NOT being requested today)

> **STOP.** Nothing in this part is authorised by this document. It is written
> down so that when the decision is made, it is made with the facts.

The primary workstation holds **43 commits** on `merge/gas-forecast-into-v2`
(HEAD `1e9dc77`) that are on no remote. Relative to what production runs
(`origin/codex/v2-foundation`, `9a270c5`), it is **23 commits ahead**.

Two things are already established and worth knowing before anyone weighs in:

- **That branch contains the containment release**
  (`6807e738f93119d8459a688ea92894f3831f2d9b` is an ancestor of `1e9dc77`), and
  the legacy case store is still **off by default** in the code —
  `legacyCaseStoreEnabled()` returns true only when
  `WELLSIM_ENABLE_LEGACY_CASE_STORE === '1'`. So deploying this branch would
  **not** silently undo the 2 September containment.
- **`.env.local` on the primary workstation sets that variable to 1** for local
  work. It is gitignored and `git archive` ships only the committed tree, so it
  cannot travel — but if anyone ever deploys by copying a directory instead,
  **that file must not go with it**.

What still stands in the way, from the 2 September audit's own gate: there is
**no staging environment**, **no CI**, and `main` is **unprotected**. The gate
says to deploy to staging first, or to production only if the absence of
staging is *explicitly accepted*. That acceptance has not been given.

When a release is authorised, follow the recorded sequence in
[`architecture/infrastructure-audit-2026-09-02.md`](architecture/infrastructure-audit-2026-09-02.md)
(§ *Recovery and deployment gate*, steps 1–9) and the mechanics in
[`deploy.md`](deploy.md) § *Deploy a new version* — replacing every
`-i ~/.ssh/wellsim_hetzner` with the current identity, and remembering that the
tar deploy **overwrites but never deletes**.

---

## 3. Also outstanding, and not fixed by any of the above

These are recorded so they are not rediscovered later as surprises:

- **Two API tokens are recorded in `HANDOVER.md` as WhatsApp-exposed and overdue
  for rotation.** Reconnecting does not address this. Anything ever pasted into
  a chat should be considered public.
- **The `wellsim-ops-2026-09-02` identity exists on one machine.** That is the
  same single-point-of-failure that caused this situation, one machine along.
  Getting a second protected copy into the password manager or a sealed backup
  is the durable fix — the audit lists it as a P1.
- **Provider backups, snapshots and delete/rebuild protection are all off** on
  the Hetzner server (P1, needs a cost decision).
- **There is still no scheduled off-box backup.** The scripts exist in the repo
  (`deploy/backup-wellsim-data.sh`, `deploy/serve-wellsim-backup.sh`,
  `deploy/pull-wellsim-backup.ps1`) and are documented in
  [`architecture/wellsim-data-recovery.md`](architecture/wellsim-data-recovery.md);
  they need the machine holding the recovery key.

---

## 4. What comes back here

Send back: **the Part B report**, and if Part C was authorised, the encrypted
archive with its checksum. With those, the primary workstation can confirm
production's true state, refresh its server snapshot, and stop treating a 1
September copy as current.

Until then it stays local-only, and nothing is pushed or deployed.

Contact: M. El-Ashry — muhamad.elashry@gmail.com
