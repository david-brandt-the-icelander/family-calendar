#!/usr/bin/env bash
# Drives the Worker on :8801 with the library's stand-in sign-in (/apps/z-calendar/auth/dev, only on localhost
# with DEV_SIGN_IN), so no login service is needed, and the made-up z-friends-and-family in test/faf-mock/ behind
# the FAF binding. Two households: Anna (admin) and Bjorn join one; Zed is alone in another and must never see theirs.
H=http://localhost:8801
B=$H/apps/z-calendar
J=$(mktemp -d)
pass=0; fail=0
chk() { if [ "$2" = "$3" ]; then printf '  ✓ %-54s %s\n' "$1" "$3"; pass=$((pass+1)); else printf '  ✗ %-54s got %s want %s\n' "$1" "$3" "$2"; fail=$((fail+1)); fi; }
# The session cookie is Secure, which curl will not send over http, so take the token and send the cookie ourselves.
signin() { curl -s "$B/auth/dev?email=$1@x.test&name=$2&format=token" | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])" > "$J/$1"; }   # signin <who> <name>
ck() { printf 'cookie: calendar_session=%s' "$(cat "$J/$1")"; }
code() { local who=$1; shift; curl -s -o /tmp/fc.json -w '%{http_code}' -H "$(ck $who)" -H 'content-type: application/json' "$@"; }
jq1() { python3 -c "import json; d=json.load(open('/tmp/fc.json')); print($1)"; }
val() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

echo "--- sign-in"
chk "signed out is 401"            401 "$(curl -s -o /dev/null -w '%{http_code}' $B/api/me)"
chk "sign-in is the login service's" 302 "$(curl -s -o /dev/null -w '%{http_code}' "$B/auth/sign-in?return=/apps/z-calendar/")"
chk "  with the new callback"      "/apps/z-calendar/auth/callback" "$(curl -s -o /dev/null -w '%{redirect_url}' "$B/auth/sign-in?return=/apps/z-calendar/" | python3 -c "import sys,urllib.parse as u; print(u.urlparse(u.parse_qs(u.urlparse(sys.stdin.read()).query)['callback'][0]).path)")"
signin anna Anna; signin bjorn Bjorn; signin zed Zed
chk "dev sign-in gives a session"  200 "$(code anna $B/api/me)"
chk "first visit makes a household" 1  "$(jq1 'len(d["households"])')"
chk "  and the person is its admin" admin "$(jq1 'd["households"][0]["role"]')"
chk "the home answers"             200 "$(curl -s -o /dev/null -w '%{http_code}' $B/health)"
chk "/apps/z-calendar gets its slash" 301 "$(curl -s -o /dev/null -w '%{http_code}' $B)"

echo "--- the old addresses"
for old in /calendar /apps/calendar; do
  chk "$old is a 301"                301 "$(curl -s -o /dev/null -w '%{http_code}' $H$old)"
  chk "  to the home"                "$B/" "$(curl -s -o /dev/null -w '%{redirect_url}' $H$old)"
  chk "  a path and query kept"      "$B/api/agenda?from=2026-11-09&to=2026-11-15" "$(curl -s -o /dev/null -w '%{redirect_url}' "$H$old/api/agenda?from=2026-11-09&to=2026-11-15")"
  chk "  HEAD too"                   301 "$(curl -s -I -o /dev/null -w '%{http_code}' $H$old/app.js)"
  chk "  a POST is refused"          405 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $H$old/api/people)"
done
chk "an old invite link still lands" "$B/join/AAAAAAAAAAAAAAAAAAAAAAAA" "$(curl -s -o /dev/null -w '%{redirect_url}' $H/calendar/join/AAAAAAAAAAAAAAAAAAAAAAAA)"

echo "--- household and invites"
chk "an admin invites"             201 "$(code anna -X POST $B/api/household/invites)"
TOKEN=$(jq1 'd["token"]')
chk "a bad invite goes nowhere"    "/apps/z-calendar/?invite=invalid" "$(curl -s -o /dev/null -w '%{redirect_url}' -H "$(ck bjorn)" $B/join/AAAAAAAAAAAAAAAAAAAAAAAA | sed 's|http://localhost:8801||')"
chk "signed out, an invite asks you to sign in" "/apps/z-calendar/auth/sign-in?return=%2Fapps%2Fz-calendar%2Fjoin%2F$TOKEN" "$(curl -s -o /dev/null -w '%{redirect_url}' $B/join/$TOKEN | sed 's|http://localhost:8801||')"
chk "the invite lets Bjorn in"     "/apps/z-calendar/" "$(curl -s -o /dev/null -w '%{redirect_url}' -H "$(ck bjorn)" $B/join/$TOKEN | sed 's|http://localhost:8801||')"
chk "and works once"               "/apps/z-calendar/?invite=invalid" "$(curl -s -o /dev/null -w '%{redirect_url}' -H "$(ck zed)" $B/join/$TOKEN | sed 's|http://localhost:8801||')"
chk "Bjorn is in Anna's household only" 1 "$(code bjorn $B/api/me >/dev/null; jq1 'len(d["households"])')"
chk "  as a member"                member "$(jq1 'd["households"][0]["role"]')"
chk "household lists two"          2 "$(code anna $B/api/household >/dev/null; jq1 'len(d["members"])')"
chk "member cannot invite"         403 "$(code bjorn -X POST $B/api/household/invites)"
chk "member cannot rename"         403 "$(code bjorn -X PATCH -d '{"name":"x"}' $B/api/household)"
chk "admin renames"                200 "$(code anna -X PATCH -d '{"name":"Fjölskyldan"}' $B/api/household)"
chk "the last admin cannot leave"  409 "$(code anna -X DELETE $B/api/household/members/dev-anna@x.test)"
chk "member cannot remove another" 403 "$(code bjorn -X DELETE $B/api/household/members/dev-anna@x.test)"
# Somebody who opened the calendar first has a household of their own when the invite arrives.
signin cara Cara; signin dag Dag
chk "Cara has her own, empty"      1 "$(code cara $B/api/me >/dev/null; jq1 'len(d["households"])')"
code anna -X POST $B/api/household/invites >/dev/null; T2=$(jq1 'd["token"]')
curl -s -o /dev/null -H "$(ck cara)" $B/join/$T2
chk "her empty one goes when she joins" 1 "$(code cara $B/api/me >/dev/null; jq1 'len(d["households"])')"
chk "  and she sees Anna's"        member "$(jq1 'd["households"][0]["role"]')"
code dag $B/api/me >/dev/null
chk "Dag puts somebody in his own" 201 "$(code dag -d '{"name":"Embla"}' $B/api/people)"
code anna -X POST $B/api/household/invites >/dev/null; T3=$(jq1 'd["token"]')
curl -s -o /dev/null -H "$(ck dag)" $B/join/$T3
chk "a household with anything in it stays" 2 "$(code dag $B/api/me >/dev/null; jq1 'len(d["households"])')"

echo "--- schedules"
A=dev-anna@x.test; Bj=dev-bjorn@x.test
code anna -d "{\"owner_kind\":\"user\",\"owner_id\":\"$Bj\",\"title\":\"Piano\",\"kind\":\"activity\"}" $B/api/schedules >/dev/null
S=$(jq1 'd.get("id","")')
chk "admin creates for another"    True "$([ -n "$S" ] && echo True)"
code anna -d "{\"owner_kind\":\"user\",\"owner_id\":\"$A\",\"title\":\"Work\",\"kind\":\"work\"}" $B/api/schedules >/dev/null
SA=$(jq1 'd.get("id","")')
chk "member cannot edit another's" 403 "$(code bjorn -X PATCH -d '{"title":"x"}' $B/api/schedules/$SA)"
BODY="{\"owner_kind\":\"user\",\"owner_id\":\"$A\",\"title\":\"x\"}"
chk "member cannot create for another" 403 "$(code bjorn -d "$BODY" $B/api/schedules)"
chk "owner sets rules"             200 "$(code bjorn -X PUT -d '{"rules":[{"weekday":2,"start_time":"16:00","end_time":"16:45"}]}' $B/api/schedules/$S/rules)"
chk "bad time is refused"          400 "$(code bjorn -X PUT -d '{"rules":[{"weekday":2,"start_time":"17:00","end_time":"16:00"}]}' $B/api/schedules/$S/rules)"
chk "agenda has two Tuesdays"      2 "$(code anna "$B/api/agenda?from=2026-11-09&to=2026-11-22" >/dev/null; jq1 'len(d["occurrences"])')"
code anna -X POST -d '{"date":"2026-11-10","kind":"cancel"}' $B/api/schedules/$S/exceptions >/dev/null
chk "cancel removes one"           1 "$(code anna "$B/api/agenda?from=2026-11-09&to=2026-11-22" >/dev/null; jq1 'len(d["occurrences"])')"
chk "people filter excludes"       0 "$(code anna "$B/api/agenda?from=2026-11-09&to=2026-11-22&people=$A" >/dev/null; jq1 'len(d["occurrences"])')"
chk "range over 62 days refused"   400 "$(code anna "$B/api/agenda?from=2026-01-01&to=2026-12-31")"
chk "everyone sees the title"      Piano "$(code bjorn "$B/api/agenda?from=2026-11-16&to=2026-11-22" >/dev/null; jq1 'd["occurrences"][0]["title"]')"
chk "dependant added"              201 "$(code bjorn -d '{"name":"Katla"}' $B/api/people)"
P=$(jq1 'd["id"]')
code bjorn -d "{\"owner_kind\":\"person\",\"owner_id\":\"$P\",\"title\":\"School\",\"kind\":\"school\"}" $B/api/schedules >/dev/null
chk "member makes a dependant's"   True "$([ -n "$(jq1 'd.get("id","")')" ] && echo True)"

echo "--- isolation"
chk "outsider has a household of their own" 1 "$(code zed $B/api/me >/dev/null; jq1 'len(d["households"])')"
chk "outsider sees no schedules"   0 "$(code zed $B/api/schedules >/dev/null; jq1 'len(d["schedules"])')"
H1=$(code anna $B/api/me >/dev/null; jq1 'd["households"][0]["id"]')
chk "outsider cannot name my household" 403 "$(code zed "$B/api/schedules?household=$H1")"
chk "outsider cannot edit mine"    404 "$(code zed -X PATCH -d '{"title":"x"}' $B/api/schedules/$S)"
chk "outsider cannot delete mine"  404 "$(code zed -X DELETE $B/api/schedules/$S)"

echo "--- family dates (z-faf stand-in)"
TODAY=$(python3 -c 'import datetime; print(datetime.datetime.now(datetime.timezone.utc).date())')
END=$(python3 -c 'import datetime; print(datetime.datetime.now(datetime.timezone.utc).date()+datetime.timedelta(days=30))')
chk "signed out gets none"         401 "$(curl -s -o /dev/null -w '%{http_code}' "$B/api/family-dates?from=$TODAY&to=$END")"
chk "the binding answers"          True "$(code anna "$B/api/family-dates?from=$TODAY&to=$END" >/dev/null; jq1 'd["available"]')"
chk "  birthdays only when asked"  "birthday" "$(code anna "$B/api/family-dates?from=$TODAY&to=$END&types=birthday" >/dev/null; jq1 '",".join(sorted(set(x["type"] for x in d["dates"])))')"
chk "  with an age when the year is known" 40 "$(jq1 '[x for x in d["dates"] if x["personId"]=="p-ari"][0]["years"]')"
chk "  and a link to the person"   "/apps/z-friends-and-family/people/p-ari" "$(jq1 '[x for x in d["dates"] if x["personId"]=="p-ari"][0]["url"]')"
chk "  a circle filter"            "Friends" "$(code anna "$B/api/family-dates?from=$TODAY&to=$END&circles=Friends" >/dev/null; jq1 '",".join(sorted(set(x["circle"] for x in d["dates"])))')"
chk "  which still lists every circle" "Family,Friends" "$(jq1 '",".join(d["circles"])')"
chk "  all time reaches the far ones" 7 "$(code anna "$B/api/family-dates?from=$TODAY&to=9999-12-31" >/dev/null; jq1 'len(d["dates"])')"
chk "  a bad range is refused"     400 "$(code anna "$B/api/family-dates?from=$END&to=$TODAY")"
signin faf-down Fafless
chk "z-faf failing is not an error" 200 "$(code faf-down "$B/api/family-dates?from=$TODAY&to=$END")"
chk "  it says it is unavailable"  False "$(jq1 'd["available"]')"
chk "  and the rest still works"   200 "$(code faf-down "$B/api/agenda?from=$TODAY&to=$END")"

echo "--- preferences"
chk "defaults to three months"     3m "$(code bjorn $B/api/prefs >/dev/null; jq1 'd["prefs"]["upcomingRange"]')"
chk "  and birthdays"              "['birthday']" "$(jq1 'd["prefs"]["familyTypes"]')"
chk "a range is kept"              200 "$(code bjorn -X PUT -d '{"upcomingRange":"1y","familyTypes":["pet","nonsense"]}' $B/api/prefs)"
chk "  for that person"            1y "$(code bjorn $B/api/prefs >/dev/null; jq1 'd["prefs"]["upcomingRange"]')"
chk "  with only known types"      "['pet']" "$(jq1 'd["prefs"]["familyTypes"]')"
chk "  and nobody else"            3m "$(code zed $B/api/prefs >/dev/null; jq1 'd["prefs"]["upcomingRange"]')"
chk "a bad range is ignored"       1y "$(code bjorn -X PUT -d '{"upcomingRange":"forever"}' $B/api/prefs >/dev/null; jq1 'd["prefs"]["upcomingRange"]')"

echo "--- leaving"
chk "a member may leave"           200 "$(code bjorn -X DELETE $B/api/household/members/$Bj)"
chk "their schedules go with them" 1 "$(code anna $B/api/schedules >/dev/null; jq1 'len([s for s in d["schedules"] if s["owner_id"]=="'$Bj'"])*0+len(d["schedules"])-1')"

echo "--- client"
chk "the page is served under /apps/z-calendar/" 200 "$(curl -s -o /dev/null -w '%{http_code}' $B/)"
chk "its script too"               200 "$(curl -s -o /dev/null -w '%{http_code}' $B/app.js)"
chk "it is light only"             True "$(curl -s $B/ | grep -q 'content="light"' && echo True)"

echo; echo "$pass passed, $fail failed"; [ $fail = 0 ]
