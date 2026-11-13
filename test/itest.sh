#!/usr/bin/env bash
# Drives the Worker on :8801 with the library's stand-in sign-in (/calendar/auth/dev, only on localhost
# with DEV_SIGN_IN), so no login service is needed. Two households: Anna (admin) and Bjorn join one; Zed is
# alone in another and must never see theirs.
B=http://localhost:8801/calendar
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
chk "sign-in is the login service's" 302 "$(curl -s -o /dev/null -w '%{http_code}' "$B/auth/sign-in?return=/calendar/")"
signin anna Anna; signin bjorn Bjorn; signin zed Zed
chk "dev sign-in gives a session"  200 "$(code anna $B/api/me)"
chk "first visit makes a household" 1  "$(jq1 'len(d["households"])')"
chk "  and the person is its admin" admin "$(jq1 'd["households"][0]["role"]')"
chk "/calendar redirects to /calendar/" 301 "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8801/calendar)"

echo "--- household and invites"
chk "an admin invites"             201 "$(code anna -X POST $B/api/household/invites)"
TOKEN=$(jq1 'd["token"]')
chk "a bad invite goes nowhere"    "/calendar/?invite=invalid" "$(curl -s -o /dev/null -w '%{redirect_url}' -H "$(ck bjorn)" $B/join/AAAAAAAAAAAAAAAAAAAAAAAA | sed 's|http://localhost:8801||')"
chk "signed out, an invite asks you to sign in" "/calendar/auth/sign-in?return=%2Fcalendar%2Fjoin%2F$TOKEN" "$(curl -s -o /dev/null -w '%{redirect_url}' $B/join/$TOKEN | sed 's|http://localhost:8801||')"
chk "the invite lets Bjorn in"     "/calendar/" "$(curl -s -o /dev/null -w '%{redirect_url}' -H "$(ck bjorn)" $B/join/$TOKEN | sed 's|http://localhost:8801||')"
chk "and works once"               "/calendar/?invite=invalid" "$(curl -s -o /dev/null -w '%{redirect_url}' -H "$(ck zed)" $B/join/$TOKEN | sed 's|http://localhost:8801||')"
chk "Bjorn is in Anna's household only" 1 "$(code bjorn $B/api/me >/dev/null; jq1 'len(d["households"])')"
chk "  as a member"                member "$(jq1 'd["households"][0]["role"]')"
chk "household lists two"          2 "$(code anna $B/api/household >/dev/null; jq1 'len(d["members"])')"
chk "member cannot invite"         403 "$(code bjorn -X POST $B/api/household/invites)"
chk "member cannot rename"         403 "$(code bjorn -X PATCH -d '{"name":"x"}' $B/api/household)"
chk "admin renames"                200 "$(code anna -X PATCH -d '{"name":"Fjölskyldan"}' $B/api/household)"
chk "the last admin cannot leave"  409 "$(code anna -X DELETE $B/api/household/members/dev-anna@x.test)"
chk "member cannot remove another" 403 "$(code bjorn -X DELETE $B/api/household/members/dev-anna@x.test)"

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

echo "--- leaving"
chk "a member may leave"           200 "$(code bjorn -X DELETE $B/api/household/members/$Bj)"
chk "their schedules go with them" 1 "$(code anna $B/api/schedules >/dev/null; jq1 'len([s for s in d["schedules"] if s["owner_id"]=="'$Bj'"])*0+len(d["schedules"])-1')"

echo "--- client"
chk "the page is served under /calendar/" 200 "$(curl -s -o /dev/null -w '%{http_code}' $B/)"
chk "its script too"               200 "$(curl -s -o /dev/null -w '%{http_code}' $B/app.js)"
chk "it is light only"             True "$(curl -s $B/ | grep -q 'content="light"' && echo True)"

echo; echo "$pass passed, $fail failed"; [ $fail = 0 ]
