resource "aws_cloudfront_distribution" "main" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "Tenure ${var.environment} — Next.js via ECS Fargate"
  price_class     = "PriceClass_100" # US, Canada, Europe

  # Custom domain — attached only once the ACM cert is validated
  aliases = var.attach_custom_domain ? [var.custom_domain] : []

  # ── Origin: Application Load Balancer ────────────────────────────────────
  origin {
    origin_id   = "alb"
    domain_name = aws_lb.main.dns_name

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "http-only"   # ALB is HTTP; CloudFront adds TLS
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_keepalive_timeout = 60
      origin_read_timeout      = 60
    }

    custom_header {
      name  = "X-Forwarded-Proto"
      value = "https"
    }
  }

  # ── Next.js static assets: long-lived cache ───────────────────────────────
  ordered_cache_behavior {
    path_pattern     = "/_next/static/*"
    target_origin_id = "alb"
    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]
    compress         = true

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    # Gated too: the build's JavaScript describes every route, action and field
    # in the product. "Private" that serves the whole client bundle to anyone
    # is not private. See edge-access.tf.
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.edge_access.arn
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 86400    # 1 day
    max_ttl                = 31536000 # 1 year
  }

  # ── Public assets: moderate cache ────────────────────────────────────────
  ordered_cache_behavior {
    path_pattern     = "/favicon*"
    target_origin_id = "alb"
    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]
    compress         = true

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.edge_access.arn
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
  }

  # ── Default: pass through to Next.js, no CloudFront cache ────────────────
  default_cache_behavior {
    target_origin_id = "alb"
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    compress         = true

    forwarded_values {
      query_string = true
      # Forward ALL headers: Next.js App Router client navigation and server
      # actions depend on RSC / Next-Action / Next-Router-State-Tree headers —
      # stripping them breaks every link click and form submit (blank pages).
      headers = ["*"]
      cookies { forward = "all" }
    }

    # Closed-pilot gate — runs before the cache, so a blocked viewer never
    # reaches the ALB. See edge-access.tf.
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.edge_access.arn
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 0
    max_ttl                = 0
  }

  # ── TLS: custom ACM cert once attached, CloudFront default until then ────
  viewer_certificate {
    cloudfront_default_certificate = var.attach_custom_domain ? null : true
    acm_certificate_arn            = var.attach_custom_domain ? aws_acm_certificate.custom[0].arn : null
    ssl_support_method             = var.attach_custom_domain ? "sni-only" : null
    minimum_protocol_version       = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  # ── WAF: attach when rate-limit / threat rules are configured ────────────
  # web_acl_id = aws_wafv2_web_acl.main.arn

  tags = { Name = "${local.name_prefix}-cf" }
}
