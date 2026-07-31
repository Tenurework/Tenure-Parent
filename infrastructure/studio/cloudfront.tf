# ── The engine's own distribution ───────────────────────────────────────────
#
# Its own, not a path on the pilot's. PD-007: a host that serves one tenant must
# not serve the console that configures all of them.

resource "aws_cloudfront_distribution" "studio" {
  enabled         = true
  comment         = "Tenure System Studio — internal platform engine"
  price_class     = "PriceClass_100"
  is_ipv6_enabled = true

  origin {
    origin_id   = "studio-alb"
    domain_name = aws_lb.studio.dns_name

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "http-only" # ALB is HTTP; CloudFront adds TLS
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_keepalive_timeout = 60
      origin_read_timeout      = 60
    }
  }

  default_cache_behavior {
    target_origin_id       = "studio-alb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # CachingDisabled. Every page here is one operator's authenticated view of
    # every tenant's configuration; a shared cache keyed on the URL would serve
    # one operator's page to the next requester, and the sign-in cookie is the
    # only thing distinguishing them.
    cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    # AllViewer — the origin needs the session cookie and the CSRF host header.
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
    minimum_protocol_version       = "TLSv1"
  }

  tags = local.tags
}
