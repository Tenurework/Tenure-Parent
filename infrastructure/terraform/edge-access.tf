# ── Edge access gate: the pilot is not open to the internet ──────────────────
#
# Temporary. Deleted when Okta is configured and the app can authenticate real
# people (see docs/RUNBOOK.md).
#
# dev-login-gate.tf puts a passphrase in front of passwordless sign-in. That is
# a control inside the application. This is the control in front of it: while
# the pilot carries a real 172-person directory and a one-click OSE_DIRECTOR
# account, the application should not be reachable from an arbitrary address at
# all. Two independent failures then have to line up before a stranger sees
# institutional data, instead of one.
#
# Implemented as a CloudFront Function rather than a WAF web ACL on purpose:
#   - It runs at the edge before the cache, so nothing reaches the origin.
#   - A WAF web ACL is ~$5/month plus ~$1 per rule; this is $0.10 per million
#     invocations. On a free-tier-constrained account that difference is the
#     whole monthly infrastructure budget, and containment is the only job
#     being asked of it today. WAF is still the right answer for rate limiting
#     and managed rule groups — see SEC-003 — and can be attached alongside.
#
# Two ways in, deliberately:
#   1. An allowlisted source address, for the operator's usual network.
#   2. A link carrying ?access=<token>, which sets a 30-day cookie. Home ISPs
#      renumber, campus networks NAT, phones are on cellular, and CloudFront is
#      IPv6-enabled so the same laptop can present a different family of address
#      than the one that was allowlisted. An IP-only gate is therefore a gate
#      that eventually locks out the person who installed it. The token is what
#      makes this recoverable without a Terraform apply, and is what gets shared
#      with pilot testers.

# Master switch. `false` leaves the function built and published but attached to
# nothing, so the pilot is reachable by anyone again — a client demo, where the
# people being shown the product are not on an allowlist and cannot be handed a
# token mid-call. Flip back to `true` the moment the demo is over: while this is
# off, the only control in front of the directory is the sign-in passphrase.
variable "edge_gate_enabled" {
  description = "Attach the closed-pilot gate to CloudFront. false = open to the internet."
  type        = bool
  default     = true # CLOSED. Open 2026-07-30 17:57Z–19:59Z for a client demo.
}

resource "random_password" "edge_access_token" {
  length  = 32
  special = false
  upper   = false
}

# Source addresses that skip the token. Exact matches, not CIDR ranges: range
# arithmetic inside the function would be more code to get wrong than it is
# worth for an operator allowlist, and the token already covers "I am somewhere
# else today".
variable "edge_allowed_ips" {
  description = "Viewer IPs that reach the pilot without the access token (exact match, v4 or v6)"
  type        = list(string)
  default = [
    "68.45.79.244",                         # operator, IPv4  (2026-07-30)
    "2601:803:380:6790:881:1548:d817:b69c", # operator, IPv6  (2026-07-30)
  ]
}

# Paths that must stay reachable without the gate.
#
#   /api/health         — .github/workflows/deploy.yml curls this from a GitHub
#                         Actions runner to prove the new build is serving. A
#                         runner's address cannot be allowlisted, and gating it
#                         would fail every deploy after a successful deploy.
#   /api/jobs/reminders — the EventBridge rule (scheduler.tf) POSTs here daily
#                         through CloudFront. Already bearer-authenticated with
#                         JOB_SECRET, and it fails closed with 503 without it.
#
# Both are exact matches, not prefixes, so /api/health/../admin cannot walk out
# of the exemption.
locals {
  edge_open_paths = ["/api/health", "/api/jobs/reminders"]

  edge_access_function = <<-JS
    function handler(event) {
      var request = event.request;

      var OPEN_PATHS = ${jsonencode(local.edge_open_paths)};
      var ALLOWED_IPS = ${jsonencode(var.edge_allowed_ips)};
      var TOKEN = ${jsonencode(random_password.edge_access_token.result)};
      var COOKIE = 'tenure_access';

      var i;

      for (i = 0; i < OPEN_PATHS.length; i++) {
        if (request.uri === OPEN_PATHS[i]) return request;
      }

      var cookies = request.cookies || {};
      if (cookies[COOKIE] && cookies[COOKIE].value === TOKEN) return request;

      var qs = request.querystring || {};
      if (qs.access && qs.access.value === TOKEN) {
        // Redirect to the same page without the token in the URL, so it stops
        // travelling through history, referrers and access logs after one use.
        var kept = [];
        for (var key in qs) {
          if (key === 'access') continue;
          kept.push(encodeURIComponent(key) + '=' + encodeURIComponent(qs[key].value));
        }
        var target = request.uri + (kept.length ? '?' + kept.join('&') : '');

        return {
          statusCode: 302,
          statusDescription: 'Found',
          headers: {
            'location':      { value: target },
            'cache-control': { value: 'no-store' }
          },
          cookies: {
            'tenure_access': {
              value: TOKEN,
              attributes: 'Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000'
            }
          }
        };
      }

      var ip = event.viewer.ip;
      for (i = 0; i < ALLOWED_IPS.length; i++) {
        if (ALLOWED_IPS[i] === ip) return request;
      }

      return {
        statusCode: 403,
        statusDescription: 'Forbidden',
        headers: {
          'content-type':  { value: 'text/html; charset=utf-8' },
          'cache-control': { value: 'no-store' }
        },
        body: '<!doctype html><meta charset="utf-8"><title>Tenure — private pilot</title>' +
              '<style>body{font:16px/1.6 system-ui,sans-serif;margin:15vh auto;max-width:32rem;padding:0 1.5rem;color:#0c1e33}' +
              'h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#4a5568;margin:0}</style>' +
              '<h1>This pilot is not open to the internet.</h1>' +
              '<p>Tenure is running a closed pilot for the University of Rochester Office of Student Engagement. ' +
              'Access is by invitation while institutional sign-in is being configured.</p>'
      };
    }
  JS
}

resource "aws_cloudfront_function" "edge_access" {
  name    = "${local.name_prefix}-edge-access"
  runtime = "cloudfront-js-2.0"
  comment = "Closed-pilot access gate. Delete when Okta is live."
  publish = true
  code    = local.edge_access_function
}

output "edge_access_url" {
  description = "One-time entry link — opening it sets a 30-day access cookie on that browser."
  value       = "https://${var.attach_custom_domain ? var.custom_domain : aws_cloudfront_distribution.main.domain_name}/?access=${random_password.edge_access_token.result}"
  sensitive   = true
}

output "edge_access_token" {
  description = "Access token alone. Also readable via the Terraform state or the CloudFront function source."
  value       = random_password.edge_access_token.result
  sensitive   = true
}
