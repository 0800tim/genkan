# Household roles: who is in the house, and what that means

A home network is not a list of children. It is a household: children, the
adults who live there, a friend's kid over for the afternoon, grandparents
staying the week, and a pile of gadgets that are nobody's at all.

Hearth used to know about three of those and guess at the rest. `children.kind`
was `child | guest | adult`, and "guest" had to cover both a visiting eight year
old and a visiting grandmother. So the one control a parent actually reaches for
at 11pm, "turn streaming off for the kids", could not be right for both: either
it swept up grandma, or it missed the visiting child.

There are now four roles, and a device class that sits outside all of them.

## The four roles

| Role | Who | Time budget | Learn to earn | In the weekly digest | Caught by a kids' control |
|---|---|---|---|---|---|
| `child` | A kid who lives here | Yes, their tier's daily allowance | Yes | Yes | Yes |
| `guest-child` | A friend's kid, visiting | No | No | No | **Yes** |
| `guest-adult` | A visiting parent or grandparent | No | No | No | **Never** |
| `adult` | A grown-up who lives here | No | No | No | Never |

Two facts fall out of the role, and every scoped control is written against
these rather than against the role itself:

- **is_kid** = `child` or `guest-child`. A control aimed at the kids reaches you.
- **is_guest** = `guest-child` or `guest-adult`. You are a visitor: no budget of
  your own, nothing to earn, and nothing about you in the family's numbers.

### What each role can and cannot do

**child.** The full arrangement. Their age tier decides the filtering
(SafeSearch, blocked services, the category blocklists), they get a daily
allowance that resets each morning, they can earn more by doing chores or a
study quiz, they are metered, and their week appears in the digest. Every
control reaches them: bedtime, dinner, study mode, "media off".

**guest-child.** Filtered like a child, controlled like a child, counted like
nobody. A visiting kid gets a filter level (the parent picks; the default is
Standard) and is caught by every control aimed at the kids, including bedtime
and the family pause. They have no daily allowance, so there is nothing to run
out and nothing to earn, and they are left out of the weekly digest and the
learn-to-earn screens. Nothing about their visit outlives it.

Why Standard and not the tightest level: you rarely know a friend's kid's age,
Standard still blocks adult, gambling, drugs, self-harm, weapons and VPNs with
SafeSearch and restricted YouTube on, and tightening it is one click on the
Family page.

**guest-adult.** Malware and adult content, and nothing else. No SafeSearch, no
blocked services, no time limit, no metering, and no kids' control will ever
reach them. Their browsing is also kept out of the per-person query log: a guest
who uses your wifi has not agreed to be watched, and the Guest filter level says
so out loud.

**adult.** Effectively unrestricted: the household blocklists (ads, malware)
and nothing else. They get no AdGuard client of their own, because the household
catch-all already gives them exactly that. The only control that reaches an
adult is the one explicitly named `everyone`.

## The thing that is not a person at all

Devices carry a class, quite separately from any of this:

- `personal` a phone, tablet, laptop, console. Assignable to a person, filtered
  and metered by whoever owns it.
- `iot` the smart lock, the camera, the speaker, the vacuum, the lights. The
  household's, never a person's.
- `infra` the access point, a switch, the gateway itself.

**No people-scoped control ever touches an `iot` or `infra` device.** Not
bedtime, not dinner, not a total cut. You do not want the front door lock going
dark at 9pm because a child was sent to bed, and you do not want the security
camera off during dinner. That guard lives in exactly one place, the
`ips_in_scope()` function in `config/db/schema-roles.sql`, and every path in
`bin/kidnet` resolves its targets through it.

This is also why the smart lock used to sit in the "assign this to a kid" queue
with nothing sensible to pick: the queue only offered people. It now offers
**Smart home device** and **Infrastructure** as well, on the Tonight page and
the Devices page, and filing a device either way takes it off whoever had it.

## Scopes: who a control reaches

`kidnet off`, `kidnet on`, `kidnet game`, `kidnet media` and `kidnet study` all
take either one person's name or one of these groups:

| Scope | Reaches |
|---|---|
| `kids` | Every child under this roof **and** every visiting child |
| `guests` | Every visitor, child and grown-up |
| `guest-kids` | Visiting children only |
| `guest-adults` | Visiting adults only |
| `adults` | Every grown-up, household and visiting |
| `household` | Everyone who lives here, no visitors |
| `all` | Everyone except the adults, plus any personal device nobody has claimed yet |
| `everyone` | Literally every personal device, adults included |

Two notes worth reading twice:

- **`all` is not everyone.** `all` is what `dinner` and bedtime use, and it
  deliberately leaves the adults alone while still catching devices nobody has
  named yet: an unclaimed tablet at 9pm is far more likely to be a child's than
  a visiting grandparent's, and a bedtime that quietly missed it would be worse
  than useless. If you genuinely mean every device in the house, say `everyone`.
- **A guest who has gone home is in no scope at all.** Marking them gone takes
  them out of every group without deleting anything.

## The 11pm scenario, worked through

The house tonight: three children (Robin, Toby, Elsie), a friend's kid staying
over (`guest-child`), and two visiting grandparents (`guest-adult`). There is
also a smart lock and a camera.

    $ kidnet person list
      Child        Robin   (young)     1 device(s)
      Child        Toby    (standard)  1 device(s)
      Child        Elsie   (teen)      1 device(s)
      Guest child  Nina    (standard)  1 device(s)
      Guest adult  Nana    (guest)     1 device(s)
      Guest adult  Grandad (guest)     1 device(s)

At 11pm, streaming off for the kids:

    $ kidnet media off kids
    media off: kids [Spotify/audio stays]

What that did, in the database:

    name   | kind        | category | blocked
    -------+-------------+----------+--------
    Robin  | child       | video    | t
    Robin  | child       | social   | t
    Toby   | child       | video    | t
    Toby   | child       | social   | t
    Elsie  | child       | video    | t
    Elsie  | child       | social   | t
    Nina   | guest-child | video    | t
    Nina   | guest-child | social   | t

Nana and Grandad are not in the list. They were never candidates: `kids` means
`is_kid`, and an adult guest is not one.

And at the DNS layer, which is where a category block is actually enforced:

    youtube.com for Nina    (guest child) -> RewriteRule  (lands on the portal)
    tiktok.com  for Nina    (guest child) -> RewriteRule
    youtube.com for Nana    (guest adult) -> NotFilteredNotFound  (plays)
    netflix.com for Nana    (guest adult) -> NotFilteredNotFound  (plays)
    spotify.com for Nina    (guest child) -> NotFilteredNotFound  (audio stays up)
    pornhub.com for Nana    (guest adult) -> FilteredBlackList    (still blocked)

That last line is the point of the guest level: an adult guest is filtered, just
very lightly, for malware and adult content and nothing else.

The same shape holds at the firewall. `kidnet off kids` puts the addresses of
every child's and every visiting child's personal devices into the `kids_block`
set, and leaves out the adult guests' tablet, the household adult's phone, the
smart lock and the access point. `test/roles-test.sh` proves exactly that
against a real nftables set.

## Guests arriving and leaving

Guests arrive at the door and leave two hours later, so this has to be quick.

**Arriving**, from the Family page: add them, choose "Visiting child" or
"Visiting adult", pick a filter level (a sensible one is already selected), then
assign their device from the naming queue on Tonight. Their AdGuard client is
created from their level as soon as they have a device, so the filtering is live
immediately rather than after somebody remembers to open the AdGuard UI.

From the command line:

    kidnet person add Nina guest-child
    kidnet assign <mac> Nina "Nina's phone"

**Leaving**, one button on the Family page ("Gone home"), or:

    kidnet guest leave Nina

In that order, because the order matters:

1. Anything blocked for them is lifted first, while Hearth still knows which
   addresses were theirs. Nothing gets left cut off in the firewall.
2. Their devices are let go and marked inactive, so they stop counting as
   anybody's and drop out of the naming queue.
3. Their category blocks are cleared.
4. They are marked inactive: in no scope, out of every list, no longer in the
   AdGuard client list.

Their row is kept, so next weekend is one command:

    kidnet guest back Nina

To delete a past guest for good, use Delete on the Family page under "past
guests", or `kidnet person`'s ordinary removal path. Their devices go back to
the unnamed list rather than disappearing.

## Where each piece lives

| Piece | File |
|---|---|
| The roles, the scopes, and the IoT guard | `config/db/schema-roles.sql` |
| The scoped controls | `bin/kidnet` (`ips_for`, `setcat`, `internet`) |
| Which filter level each role gets in AdGuard | `bin/kidnet-adguard-clients` |
| Metering household children only | `bin/kidnet-meter` |
| The roles on screen, the guest buttons, the device classes | `dashboard/household.mjs` |
| The proof | `test/roles-test.sh` |

## Two honest limits

- **A guest's name should be a plain name.** `kidnet` accepts letters, numbers,
  `-` and `_` in a person's name, because that name reaches a shell command line
  and an AdGuard client identifier. Group controls and the guest buttons on the
  Family page work by database id, so a household that already holds somebody
  called `Guest (kid)` keeps working, but you cannot address that person
  individually from the command line until they are renamed.
- **The AdGuard guest level is a level, not a promise about content.** It turns
  on AdGuard's parental filter and safe browsing. That catches the obvious adult
  and malware domains. It is not a content classifier, and it never was.
