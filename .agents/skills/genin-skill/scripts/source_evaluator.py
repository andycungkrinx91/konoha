#!/usr/bin/env python3
"""
Source Credibility Evaluator
Assesses source quality, credibility, and potential biases with advanced scoring,
subdomain analysis, content-type classification, and geographic bias detection.

Requires: Python 3.8+ (stdlib only)
"""

import argparse
import csv
import json
import os
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Any, Set, Tuple
from urllib.parse import urlparse


@dataclass
class CredibilityScore:
    """Represents source credibility assessment"""
    url: str
    overall_score: float  # 0-100
    domain_authority: float  # 0-100
    recency: float  # 0-100
    expertise: float  # 0-100
    bias_score: float  # 0-100 (higher = more neutral)
    content_type_score: float  # 0-100
    subdomain_score: float  # 0-100
    cross_reference_boost: float  # 0-20
    geographic_bias: str  # e.g., "low_risk", "regional_bias", "state_controlled"
    content_type: str  # api_docs, blog_post, changelog, press_release, research_paper, discussion, general
    factors: Dict[str, str] = field(default_factory=dict)
    recommendation: str = "verify"  # "high_trust", "moderate_trust", "low_trust", "verify"


class SourceEvaluator:
    """Evaluates source credibility, authority, recency, expertise, and bias"""

    # Domain reputation tiers
    HIGH_AUTHORITY_DOMAINS = {
        # Academic & Research
        'arxiv.org', 'nature.com', 'science.org', 'cell.com', 'nejm.org',
        'thelancet.com', 'springer.com', 'sciencedirect.com', 'plos.org',
        'ieee.org', 'acm.org', 'pubmed.ncbi.nlm.nih.gov', 'pnas.org',
        'mit.edu', 'stanford.edu', 'harvard.edu', 'berkeley.edu', 'ox.ac.uk',
        'cam.ac.uk', 'ethz.ch', 'caltech.edu', 'cern.ch', 'salk.edu',

        # Government & International Organizations
        'nih.gov', 'cdc.gov', 'who.int', 'fda.gov', 'nasa.gov', 'noaa.gov',
        'gov.uk', 'europa.eu', 'un.org', 'w3.org', 'ietf.org', 'iso.org',
        'ansi.org', 'nist.gov', 'epa.gov', 'usda.gov', 'loc.gov',

        # Established Tech Documentation & Platforms
        'docs.python.org', 'developer.mozilla.org', 'docs.microsoft.com',
        'cloud.google.com', 'aws.amazon.com', 'kubernetes.io', 'docs.docker.com',
        'github.com', 'gitlab.com', 'rust-lang.org', 'go.dev', 'nodejs.org',
        'typescriptlang.org', 'react.dev', 'angular.io', 'vuejs.org', 'spring.io',
        'oracle.com/java', 'postgresql.org', 'mysql.com', 'mongodb.com', 'redis.io',
        'terraform.io', 'nginx.com', 'apache.org', 'w3schools.com',

        # Cloud & CDN Providers
        'cloudflare.com', 'fastly.com', 'akamai.com', 'digitalocean.com',
        'heroku.com', 'vercel.com', 'netlify.com', 'supabase.com', 'firebase.google.com',

        # Security Vendors & Certifying Authorities
        'cve.mitre.org', 'nvd.nist.gov', 'owasp.org', 'sans.org', 'cisecurity.org',
        'portswigger.net', 'checkpoint.com', 'paloaltonetworks.com', 'fireeye.com',
        'mandiant.com', 'crowdstrike.com', 'kaspersky.com', 'symantec.com',
        'mcafee.com', 'tenable.com', 'rapid7.com', 'qualys.com', 'okta.com',
        'auth0.com', 'letsencrypt.org', 'digicert.com',

        # Reputable News (Fact-check verified)
        'reuters.com', 'apnews.com', 'bbc.com', 'economist.com', 'wsj.com',
        'nytimes.com', 'ft.com', 'bloomberg.com', 'scientificamerican.com',
        'newscientist.com', 'technologyreview.com'
    }

    MODERATE_AUTHORITY_DOMAINS = {
        # Tech News & Analysis
        'techcrunch.com', 'theverge.com', 'arstechnica.com', 'wired.com',
        'zdnet.com', 'cnet.com', 'venturebeat.com', 'thenextweb.com',
        'engadget.com', 'gizmodo.com', 'slashdot.org', 'infoworld.com',
        'computerworld.com', 'networkworld.com', 'eeedit.com',

        # Developer Blogs & Communities (moderated)
        'medium.com', 'dev.to', 'stackoverflow.com', 'stackexchange.com',
        'reddit.com/r/programming', 'news.ycombinator.com', 'hashnode.com',
        'dzone.com', 'infoq.com', 'codeproject.com', 'freecodecamp.org',
        'devops.com', 'securityweekly.com', 'darkreading.com', 'threatpost.com',
        'bleepingcomputer.com', 'hackernews.com', 'hackerone.com',

        # Industry Leaders & Enterprise IT
        'ibm.com', 'microsoft.com', 'oracle.com', 'redhat.com', 'cisco.com',
        'intel.com', 'nvidia.com', 'amd.com', 'salesforce.com', 'sap.com',
        'vmware.com', 'dell.com', 'hp.com', 'accenture.com', 'gartner.com',
        'forrester.com', 'idc.com',

        # AI & ML Platforms
        'huggingface.co', 'openai.com', 'anthropic.com', 'deepmind.google',
        'pytorch.org', 'tensorflow.org', 'keras.io', 'kaggle.com', 'weightsandbiases.com',
        'cohere.com', 'mistral.ai', 'pinecone.io', 'weaviate.io',

        # Fintech & Crypto Platforms (established)
        'coinbase.com', 'stripe.com', 'paypal.com', 'adyen.com', 'plaid.com',
        'coindesk.com', 'cointelegraph.com', 'ethereum.org', 'bitcoin.org',
        'binance.com', 'chainalysis.com', 'elliptic.co',

        # Biotech & Healthcare Industry
        'mayoclinic.org', 'healthline.com', 'webmd.com', 'medscape.com',
        'nih.gov/news-events', 'statnews.com', 'biopharmadive.com',

        # Educational & General Reference
        'wikipedia.org', 'britannica.com', 'khanacademy.org', 'coursera.org',
        'edx.org', 'udacity.com', 'oreilly.com', 'packtpub.com'
    }

    LOW_AUTHORITY_INDICATORS = [
        'blogspot.com', 'wordpress.com', 'wix.com', 'substack.com', 'weebly.com',
        'medium.com/@', 'tumblr.com', 'github.io', 'gitlab.io', 'pages.dev',
        'netlify.app', 'vercel.app', 'self-published', 'forum', 'community',
        'discourse', 'discord.gg', 't.me', 'twitter.com', 'x.com', 'facebook.com',
        'instagram.com', 'linkedin.com/posts', 'youtube.com', 'vimeo.com'
    ]

    # Specific subdomains to evaluate authority differently
    SUBDOMAIN_MODIFIERS = {
        'docs': 15.0,
        'developer': 15.0,
        'developers': 15.0,
        'api': 12.0,
        'kb': 10.0,
        'support': 5.0,
        'git': 5.0,
        'blog': -5.0,
        'news': -5.0,
        'press': -5.0,
        'forum': -15.0,
        'community': -15.0,
        'discussion': -15.0,
        'status': -10.0,
        'wiki': -8.0,
        'pages': -12.0
    }

    # State-controlled media domains (for geographic bias assessment)
    STATE_CONTROLLED_DOMAINS = {
        'rt.com', 'sputniknews.com', 'tass.com', 'riafan.ru',  # Russia
        'xinhuanet.com', 'chinadaily.com.cn', 'cgtn.com', 'globaltimes.cn',  # China
        'presstv.ir', 'irna.ir',  # Iran
        'kcna.kp',  # North Korea
        'sana.sy',  # Syria
        'venezolana.com.ve'  # Venezuela
    }

    # Regional domains indicating localized focus or potential local jurisdiction influence
    REGIONAL_TLD_MAP = {
        '.cn': 'East Asia (China)',
        '.ru': 'Eastern Europe (Russia)',
        '.ir': 'Middle East (Iran)',
        '.kp': 'East Asia (North Korea)',
        '.sy': 'Middle East (Syria)',
        '.su': 'Soviet Union TLD (Legacy/Russia)',
        '.by': 'Eastern Europe (Belarus)',
        '.co.uk': 'Western Europe (UK)',
        '.gov.uk': 'Western Europe (UK Government)',
        '.gov.au': 'Oceania (Australia Government)',
        '.eu': 'European Union',
        '.us': 'North America (USA)',
        '.mil': 'US Military',
        '.gov': 'US Government'
    }

    def __init__(self):
        pass

    def evaluate_source(
        self,
        url: str,
        title: str,
        content: Optional[str] = None,
        publication_date: Optional[str] = None,
        author: Optional[str] = None,
        cross_references: float = 0.0
    ) -> CredibilityScore:
        """Evaluate source credibility and quality details"""
        domain, subdomain = self._extract_domain_and_subdomain(url)

        # 1. Base Domain Score
        domain_score = self._evaluate_domain_authority(domain)

        # 2. Subdomain Modifier
        subdomain_mod = self._evaluate_subdomain_modifier(subdomain)
        subdomain_score = min(100.0, max(0.0, domain_score + subdomain_mod))

        # 3. Content Type Scoring & Classification
        content_type, content_type_score = self._classify_content_type(url, title, content)

        # 4. Recency Score
        recency_score = self._evaluate_recency(publication_date)

        # 5. Expertise Score
        expertise_score = self._evaluate_expertise(domain, subdomain, title, author, content_type)

        # 6. Bias & Objectivity Score
        bias_score = self._evaluate_bias(domain, title, content)

        # 7. Geographic Bias Assessment
        geo_bias = self._evaluate_geographic_bias(domain)

        # Adjust score for state-controlled domains
        if geo_bias == "state_controlled":
            bias_score = min(bias_score, 30.0)
            domain_score = min(domain_score, 45.0)
            subdomain_score = min(subdomain_score, 45.0)

        # 8. Cross-Reference Boost
        # In a batch context, this can be increased if cited by other sources.
        cross_ref_boost = min(20.0, cross_references)

        # 9. Weighted Overall Score Calculation
        overall = (
            subdomain_score * 0.30 +
            recency_score * 0.15 +
            expertise_score * 0.20 +
            bias_score * 0.20 +
            content_type_score * 0.15
        ) + cross_ref_boost

        overall = min(100.0, max(0.0, overall))

        # Identify key credibility factors
        factors = self._identify_factors(
            domain, subdomain, subdomain_score, recency_score, expertise_score, bias_score, content_type, geo_bias, cross_ref_boost
        )

        # Generate recommendation
        recommendation = self._generate_recommendation(overall, geo_bias)

        return CredibilityScore(
            url=url,
            overall_score=round(overall, 2),
            domain_authority=round(domain_score, 2),
            recency=round(recency_score, 2),
            expertise=round(expertise_score, 2),
            bias_score=round(bias_score, 2),
            content_type_score=round(content_type_score, 2),
            subdomain_score=round(subdomain_score, 2),
            cross_reference_boost=round(cross_ref_boost, 2),
            geographic_bias=geo_bias,
            content_type=content_type,
            factors=factors,
            recommendation=recommendation
        )

    def evaluate_batch(self, sources: List[Dict[str, Any]]) -> List[CredibilityScore]:
        """
        Evaluates a batch of sources in parallel, detecting cross-references to boost credibility.
        Each source dict should have: 'url', 'title', and optionally 'content', 'publication_date', 'author'.
        """
        # First pass: standard evaluation without cross-reference boost
        evals: List[CredibilityScore] = []
        domain_frequency = defaultdict(int)

        # Extract domains to see what is mentioned
        for s in sources:
            parsed = urlparse(s.get('url', ''))
            dom = parsed.netloc.lower().replace('www.', '')
            if dom:
                domain_frequency[dom] += 1

        # Check references in content to build citation counts
        citation_boosts = defaultdict(float)
        for s in sources:
            content = s.get('content', '') or ''
            title = s.get('title', '') or ''
            text_to_scan = f"{content} {title}".lower()

            for target_dom in domain_frequency:
                # If a domain is cited by another domain, boost it
                if target_dom in text_to_scan:
                    # Don't count self-citations
                    source_dom = urlparse(s.get('url', '')).netloc.lower().replace('www.', '')
                    if source_dom != target_dom:
                        # High authority domains boost more
                        boost_val = 2.0
                        if source_dom in self.HIGH_AUTHORITY_DOMAINS:
                            boost_val = 5.0
                        elif source_dom in self.MODERATE_AUTHORITY_DOMAINS:
                            boost_val = 3.5
                        citation_boosts[target_dom] += boost_val

        # Second pass: evaluate with calculated boosts
        for s in sources:
            url = s.get('url', '')
            dom = urlparse(url).netloc.lower().replace('www.', '')
            boost = citation_boosts.get(dom, 0.0)

            score = self.evaluate_source(
                url=url,
                title=s.get('title', ''),
                content=s.get('content'),
                publication_date=s.get('publication_date'),
                author=s.get('author'),
                cross_references=boost
            )
            evals.append(score)

        return evals

    def _extract_domain_and_subdomain(self, url: str) -> Tuple[str, str]:
        """Extract domain and subdomain from URL"""
        try:
            parsed = urlparse(url)
            netloc = parsed.netloc.lower()
            # Remove port if present
            netloc = netloc.split(':')[0]
            # Remove www prefix
            if netloc.startswith('www.'):
                netloc = netloc[4:]

            parts = netloc.split('.')
            if len(parts) > 2:
                # e.g., docs.google.com -> subdomain is 'docs', domain is 'google.com'
                # Handle multipart TLDs like .co.uk or .com.cn
                if len(parts) >= 4 or parts[-2] in ('com', 'co', 'org', 'gov', 'edu', 'net', 'ac', 'mil'):
                    domain = ".".join(parts[-3:])
                    subdomain = ".".join(parts[:-3])
                else:
                    domain = ".".join(parts[-2:])
                    subdomain = ".".join(parts[:-2])
            else:
                domain = netloc
                subdomain = ""
            return domain, subdomain
        except Exception:
            return "", ""

    def _evaluate_domain_authority(self, domain: str) -> float:
        """Evaluate domain authority (0-100)"""
        if not domain:
            return 30.0

        if domain in self.HIGH_AUTHORITY_DOMAINS:
            return 95.0
        elif domain in self.MODERATE_AUTHORITY_DOMAINS:
            return 75.0

        # Check for indicators in the domain string
        if any(indicator in domain for indicator in self.LOW_AUTHORITY_INDICATORS):
            return 40.0

        # General/unknown domains get a neutral starting score
        return 55.0

    def _evaluate_subdomain_modifier(self, subdomain: str) -> float:
        """Calculate score adjustment based on subdomain type (+15 to -15)"""
        if not subdomain:
            return 0.0

        # Check if the subdomain itself is in the modifiers dictionary
        for prefix, modifier in self.SUBDOMAIN_MODIFIERS.items():
            if subdomain == prefix or subdomain.startswith(prefix + '.'):
                return modifier

        return 0.0

    def _classify_content_type(self, url: str, title: str, content: Optional[str]) -> Tuple[str, float]:
        """
        Classifies the source content type and determines its base quality rating.
        Types: api_docs, blog_post, changelog, press_release, research_paper, discussion, general
        """
        url_lower = url.lower()
        title_lower = title.lower()
        content_lower = (content or "").lower()

        # 1. Research Papers / Academic Articles
        if ('arxiv.org' in url_lower or 'nature.com/articles' in url_lower or
                re.search(r'\b(doi|journal|abstract|issn|isbn|preprint|thesis|dissertation)\b', title_lower + content_lower) or
                url_lower.endswith('.pdf') and ('research' in url_lower or 'paper' in url_lower)):
            return 'research_paper', 95.0

        # 2. API Reference / Technical Documentation
        if (any(x in url_lower for x in ['/docs', '/doc/', '/developer', '/api', '/reference', '/guide', '/manual']) or
                any(x in title_lower for x in ['documentation', 'api reference', 'developer docs', 'getting started', 'quickstart'])):
            return 'api_docs', 90.0

        # 3. Changelogs & Release Notes
        if (any(x in url_lower for x in ['/changelog', '/release', '/whats-new', '/tag', '/releases']) or
                any(x in title_lower for x in ['changelog', 'release notes', 'version updates', 'what\'s new in'])):
            return 'changelog', 85.0

        # 4. Press Releases & Corporate Announcements
        if (any(x in url_lower for x in ['/press', '/newsroom', '/announcement', '/pr-']) or
                any(x in title_lower for x in ['press release', 'announces', 'launches', 'introduces', 'unveils'])):
            return 'press_release', 70.0

        # 5. Forums & Discussions (Community Q&A, issue boards)
        if (any(x in url_lower for x in ['/forum', '/issues', '/discussion', '/thread', '/qna', 'stack overflow', 'reddit.com']) or
                any(x in title_lower for x in ['issue #', 'how do i', 'how to fix', 'question about'])):
            return 'discussion', 45.0

        # 6. Blog Posts
        if (any(x in url_lower for x in ['/blog', '/post', '/article']) or
                any(x in title_lower for x in ['blog', 'opinion', 'tutorial', 'how to'])):
            return 'blog_post', 65.0

        # 7. General Web Pages
        return 'general', 55.0

    def _evaluate_recency(self, publication_date: Optional[str]) -> float:
        """Evaluate information recency (0-100)"""
        if not publication_date:
            return 50.0  # Neutral score for unknown publication dates

        try:
            # Parse different common date formats
            pub_date = None
            date_str = publication_date.replace('Z', '+00:00')
            try:
                pub_date = datetime.fromisoformat(date_str)
            except ValueError:
                # Try simple YYYY-MM-DD
                cleaned_date = re.search(r'\d{4}-\d{2}-\d{2}', date_str)
                if cleaned_date:
                    pub_date = datetime.strptime(cleaned_date.group(0), '%Y-%m-%d')

            if not pub_date:
                return 50.0

            # Ensure timezone awareness matches
            now = datetime.now()
            if pub_date.tzinfo is not None:
                now = datetime.now(pub_date.tzinfo)

            age = now - pub_date

            # Recency scoring decay curve
            if age < timedelta(days=30):  # < 1 month: super fresh
                return 100.0
            elif age < timedelta(days=90):  # < 3 months: fresh
                return 95.0
            elif age < timedelta(days=365):  # < 1 year: current
                return 85.0
            elif age < timedelta(days=730):  # < 2 years: slightly old
                return 70.0
            elif age < timedelta(days=1825):  # < 5 years: outdated
                return 45.0
            else:  # Legacy
                return 20.0

        except Exception:
            return 50.0

    def _evaluate_expertise(
        self,
        domain: str,
        subdomain: str,
        title: str,
        author: Optional[str],
        content_type: str
    ) -> float:
        """Evaluate source expertise (0-100)"""
        score = 50.0  # Baseline

        # content_type factors
        if content_type == 'research_paper':
            score += 35
        elif content_type == 'api_docs':
            score += 30
        elif content_type == 'changelog':
            score += 20

        # Domain/subdomain clues
        if subdomain in ('docs', 'developer', 'api', 'kb'):
            score += 15

        if any(d in domain for d in ['arxiv', 'nature', 'science', 'ieee', 'acm', 'springer', 'edu']):
            score += 20
        if '.gov' in domain or '.mil' in domain:
            score += 15

        # Author credentials (if available)
        if author:
            author_lower = author.lower()
            if any(x in author_lower for x in ['dr.', 'phd', 'professor', 'prof.', 'researcher', 'scientist']):
                score += 15
            if any(x in author_lower for x in ['engineer', 'developer', 'architect', 'expert']):
                score += 8

        return min(score, 100.0)

    def _evaluate_bias(
        self,
        domain: str,
        title: str,
        content: Optional[str]
    ) -> float:
        """Evaluate potential bias (0-100, higher = more neutral)"""
        score = 75.0  # Start moderately neutral

        # Check for sensationalism/clickbait in title
        sensational_indicators = [
            '!', 'shocking', 'unbelievable', 'you won\'t believe',
            'secret', 'they don\'t want you to know', 'exposed',
            'scam', 'conspiracy', 'miracle', 'revolutionize', 'destroy',
            'collapse', 'kill', 'genius', 'worst', 'best ever'
        ]
        title_lower = title.lower()
        if any(indicator in title_lower for indicator in sensational_indicators):
            score -= 25

        # Domain reputation check
        if any(d in domain for d in ['arxiv', 'nature', 'science', 'ieee', 'nih.gov', 'w3.org']):
            score += 15  # Peer-reviewed/standards-based are typically less biased

        # Check for balanced arguments in content
        if content:
            content_lower = content.lower()
            balanced_indicators = [
                'however', 'although', 'on the other hand', 'critics argue',
                'alternative perspective', 'nevertheless', 'contrary to',
                'more research is needed', 'limitations of', 'not without issues'
            ]
            balanced_count = sum(1 for ind in balanced_indicators if ind in content_lower)
            if balanced_count >= 3:
                score += 10
            elif balanced_count >= 1:
                score += 5

            # Deduct score for high emotional or marketing terms
            marketing_indicators = [
                'buy now', 'hurry', 'limited offer', 'guaranteed success',
                'industry-leading', 'game changer', 'ultimate guide to'
            ]
            marketing_count = sum(1 for ind in marketing_indicators if ind in content_lower)
            score -= (marketing_count * 5)

        return min(max(score, 0.0), 100.0)

    def _evaluate_geographic_bias(self, domain: str) -> str:
        """Determines geographical/regional bias risks or state-control flags"""
        if domain in self.STATE_CONTROLLED_DOMAINS:
            return "state_controlled"

        # Check TLD endings
        for tld, region in self.REGIONAL_TLD_MAP.items():
            if domain.endswith(tld):
                # If state-controlled TLD like .su, .kp, .ir
                if tld in ('.kp', '.ir', '.sy', '.su', '.ru'):
                    return f"high_risk_region ({region})"
                return f"regional_focus ({region})"

        return "low_risk"

    def _identify_factors(
        self,
        domain: str,
        subdomain: str,
        subdomain_score: float,
        recency_score: float,
        expertise_score: float,
        bias_score: float,
        content_type: str,
        geo_bias: str,
        cross_ref_boost: float
    ) -> Dict[str, str]:
        """Identify key credibility factors for reporting"""
        factors = {}

        # Domain/subdomain factors
        if subdomain_score >= 85:
            factors['authority'] = f"High authority domain/subdomain ({subdomain}.{domain})" if subdomain else f"High authority domain ({domain})"
        elif subdomain_score <= 45:
            factors['authority'] = f"Low authority domain/subdomain ({subdomain}.{domain})" if subdomain else f"Low authority domain ({domain})"

        # Recency factors
        if recency_score >= 85:
            factors['recency'] = "Highly recent and up-to-date information"
        elif recency_score <= 40:
            factors['recency'] = "Outdated information - verify currency"

        # Expertise factors
        if expertise_score >= 80:
            factors['expertise'] = "Strong expertise signals (peer-reviewed, standard, or official documentation)"
        elif expertise_score <= 45:
            factors['expertise'] = "Limited expertise indicators - self-published or community source"

        # Bias factors
        if bias_score >= 80:
            factors['bias'] = "Balanced perspective with minimal sensationalism"
        elif bias_score <= 50:
            factors['bias'] = "Potential bias, clickbait styling, or marketing focus detected"

        # Content Type
        factors['content_type'] = f"Categorized as: {content_type.replace('_', ' ').title()}"

        # Geographic Bias
        if geo_bias == "state_controlled":
            factors['geographic'] = "WARNING: Published by state-controlled media outlet"
        elif "high_risk_region" in geo_bias:
            factors['geographic'] = f"High-risk region origin: {geo_bias}"
        elif "regional_focus" in geo_bias:
            factors['geographic'] = f"Local regional focus: {geo_bias}"

        # Cross reference boost
        if cross_ref_boost > 0:
            factors['cross_reference'] = f"Credibility boosted by {round(cross_ref_boost, 1)} points due to peer citations"

        return factors

    def _generate_recommendation(self, overall_score: float, geo_bias: str) -> str:
        """Generate trust recommendation"""
        if geo_bias == "state_controlled":
            return "verify"

        if overall_score >= 82:
            return "high_trust"
        elif overall_score >= 62:
            return "moderate_trust"
        elif overall_score >= 42:
            return "low_trust"
        else:
            return "verify"

    def export_results(self, scores: List[CredibilityScore], filepath: str, export_format: str = 'json'):
        """Export credibility assessment scores to JSON or CSV"""
        path = Path(filepath)
        path.parent.mkdir(parents=True, exist_ok=True)

        serializable = [asdict(s) for s in scores]

        if export_format.lower() == 'json':
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(serializable, f, indent=2)
            print(f"Successfully exported JSON scores to: {path}")
        elif export_format.lower() == 'csv':
            if not scores:
                return
            headers = [
                'url', 'overall_score', 'domain_authority', 'recency', 'expertise',
                'bias_score', 'content_type_score', 'subdomain_score',
                'cross_reference_boost', 'geographic_bias', 'content_type', 'recommendation'
            ]
            with open(path, 'w', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                writer.writerow(headers)
                for score in scores:
                    writer.writerow([
                        score.url, score.overall_score, score.domain_authority, score.recency,
                        score.expertise, score.bias_score, score.content_type_score,
                        score.subdomain_score, score.cross_reference_boost, score.geographic_bias,
                        score.content_type, score.recommendation
                    ])
            print(f"Successfully exported CSV scores to: {path}")
        else:
            raise ValueError(f"Unsupported export format: {export_format}")


def main():
    """CLI Entrypoint for Source Credibility Evaluator"""
    parser = argparse.ArgumentParser(
        description="Source Credibility Evaluator — Assessment for Web/Academic Sources"
    )

    parser.add_argument(
        '--url', '-u',
        type=str,
        help='The URL to evaluate'
    )

    parser.add_argument(
        '--title', '-t',
        type=str,
        help='The source title'
    )

    parser.add_argument(
        '--date', '-d',
        type=str,
        help='The publication date (ISO format)'
    )

    parser.add_argument(
        '--author', '-a',
        type=str,
        help='Author name'
    )

    parser.add_argument(
        '--batch', '-b',
        type=str,
        help='Path to a JSON file containing a list of sources to evaluate in batch'
    )

    parser.add_argument(
        '--output', '-o',
        type=str,
        help='Output path for saving evaluation report'
    )

    parser.add_argument(
        '--format', '-f',
        type=str,
        choices=['json', 'csv'],
        default='json',
        help='Output format (default: json)'
    )

    args = parser.parse_args()

    evaluator = SourceEvaluator()

    if args.batch:
        batch_path = Path(args.batch)
        if not batch_path.exists():
            print(f"Error: Batch file not found at: {batch_path}", file=sys.stderr)
            sys.exit(1)

        with open(batch_path, 'r', encoding='utf-8') as f:
            sources_to_eval = json.load(f)

        if not isinstance(sources_to_eval, list):
            print("Error: Batch file must be a JSON array of source objects.", file=sys.stderr)
            sys.exit(1)

        print(f"Evaluating {len(sources_to_eval)} sources in batch...")
        results = evaluator.evaluate_batch(sources_to_eval)

        # Print summary
        for r in results:
            print(f"\n- URL: {r.url}")
            print(f"  Score: {r.overall_score}/100 | Rec: {r.recommendation} | Type: {r.content_type}")

        if args.output:
            evaluator.export_results(results, args.output, args.format)

    elif args.url and args.title:
        # Single evaluation
        result = evaluator.evaluate_source(
            url=args.url,
            title=args.title,
            publication_date=args.date,
            author=args.author
        )

        print(f"\n=== Evaluation Report ===")
        print(f"URL:            {result.url}")
        print(f"Overall Score:  {result.overall_score}/100")
        print(f"Recommendation: {result.recommendation.upper()}")
        print(f"Content Type:   {result.content_type.replace('_', ' ').title()}")
        print(f"Geographic Risk:{result.geographic_bias}")
        print("\nFactors:")
        for category, factor in result.factors.items():
            print(f"  - [{category.title()}] {factor}")

        if args.output:
            evaluator.export_results([result], args.output, args.format)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == '__main__':
    main()
