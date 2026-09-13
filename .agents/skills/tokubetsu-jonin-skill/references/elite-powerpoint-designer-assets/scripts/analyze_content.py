#!/usr/bin/env python3
"""
Elite PowerPoint Designer - Content Analyzer
Analyzes markdown content and recommends brand style and template mapping.
"""

import sys
import json
import re
from typing import Dict, List, Tuple

class ContentAnalyzer:
    def __init__(self):
        self.keywords = {
            'tech-keynote': ['product', 'launch', 'innovation', 'demo', 'revolutionary', 'future', 'transform'],
            'corporate-professional': ['business', 'strategy', 'report', 'proposal', 'enterprise', 'quarter', 'results'],
            'creative-bold': ['brand', 'marketing', 'campaign', 'creative', 'design', 'experience', 'engage'],
            'financial-elite': ['investment', 'financial', 'investor', 'portfolio', 'capital', 'returns', 'valuation'],
            'startup-pitch': ['startup', 'funding', 'traction', 'growth', 'market', 'team', 'vision', 'problem', 'solution']
        }

        self.slide_patterns = {
            'title_slide': r'^#\s+(.+)$',
            'chapter_intro': r'^##\s+(.+)$',
            'key_message': r'^###\s+(.+)$',
            'bullet_list': r'^\*\s+(.+)$|^-\s+(.+)$',
            'quote': r'^>\s+(.+)$',
            'image': r'!\[.*?\]\((.+?)\)',
            'table': r'^\|.+\|.+\|$',
            'metrics': r'(\d+\.?\d*[%$€£¥M-Z]*)',
            'section_break': r'^===+$'
        }

    def analyze(self, content: str) -> Dict:
        """Analyze content and return recommendations."""
        lines = content.split('\n')

        # Extract frontmatter if present
        frontmatter = self._extract_frontmatter(content)

        # Analyze content for style recommendation
        style = frontmatter.get('style') or self._recommend_style(content)

        # Map slides
        slides = self._map_slides(lines)

        # Detect metrics and key data
        metrics = self._extract_metrics(content)

        # Count slide types
        slide_stats = self._calculate_stats(slides)

        return {
            'recommended_style': style,
            'frontmatter': frontmatter,
            'total_slides': len(slides),
            'slide_structure': slides,
            'key_metrics': metrics,
            'statistics': slide_stats,
            'estimated_duration': len(slides)  # 1 slide per minute rule
        }

    def _extract_frontmatter(self, content: str) -> Dict:
        """Extract YAML frontmatter from markdown."""
        match = re.match(r'^---\s*\n(.*?)\n---\s*\n', content, re.DOTALL)
        if not match:
            return {}

        frontmatter = {}
        yaml_content = match.group(1)

        # Simple YAML parser (only handles key: value pairs)
        for line in yaml_content.split('\n'):
            if ':' in line:
                key, value = line.split(':', 1)
                frontmatter[key.strip()] = value.strip().strip('"\'')

        return frontmatter

    def _recommend_style(self, content: str) -> str:
        """Recommend brand style based on content analysis."""
        content_lower = content.lower()

        scores = {}
        for style, keywords in self.keywords.items():
            score = sum(content_lower.count(keyword) for keyword in keywords)
            scores[style] = score

        # Return style with highest score
        recommended = max(scores.items(), key=lambda x: x[1])

        # Default to corporate-professional if no clear winner
        if recommended[1] == 0:
            return 'corporate-professional'

        return recommended[0]

    def _map_slides(self, lines: List[str]) -> List[Dict]:
        """Map markdown lines to slide templates."""
        slides = []
        current_slide = None

        for i, line in enumerate(lines):
            line = line.strip()

            if not line:
                continue

            # Title slide (# Header)
            if re.match(r'^#\s+[^#]', line):
                if current_slide:
                    slides.append(current_slide)
                current_slide = {
                    'type': 'title_slide',
                    'template': 'title_slide',
                    'content': {
                        'title': re.sub(r'^#\s+', '', line)
                    },
                    'line_number': i + 1
                }

            # Section/Chapter (## Header)
            elif re.match(r'^##\s+[^#]', line):
                if current_slide:
                    slides.append(current_slide)
                current_slide = {
                    'type': 'section',
                    'template': 'chapter_intro',
                    'content': {
                        'title': re.sub(r'^##\s+', '', line)
                    },
                    'line_number': i + 1
                }

            # Key message (### Header)
            elif re.match(r'^###\s+', line):
                if current_slide:
                    slides.append(current_slide)
                current_slide = {
                    'type': 'key_message',
                    'template': 'key_metrics_dashboard',
                    'content': {
                        'title': re.sub(r'^###\s+', '', line),
                        'bullets': []
                    },
                    'line_number': i + 1
                }

            # Bullets
            elif re.match(r'^[\*\-]\s+', line):
                if current_slide and 'bullets' in current_slide['content']:
                    bullet_text = re.sub(r'^[\*\-]\s+', '', line)
                    current_slide['content']['bullets'].append(bullet_text)
                else:
                    if current_slide:
                        slides.append(current_slide)
                    current_slide = {
                        'type': 'bullets',
                        'template': 'two_column_text',
                        'content': {
                            'bullets': [re.sub(r'^[\*\-]\s+', '', line)]
                        },
                        'line_number': i + 1
                    }

            # Quote
            elif re.match(r'^>\s+', line):
                if current_slide:
                    slides.append(current_slide)
                current_slide = {
                    'type': 'quote',
                    'template': 'quote_testimonial',
                    'content': {
                        'quote': re.sub(r'^>\s+', '', line)
                    },
                    'line_number': i + 1
                }

            # Image
            elif re.search(r'!\[.*?\]\((.+?)\)', line):
                images = re.findall(r'!\[.*?\]\((.+?)\)', line)
                if current_slide:
                    slides.append(current_slide)
                current_slide = {
                    'type': 'image',
                    'template': 'full_image_slide' if len(images) == 1 else 'two_column_text',
                    'content': {
                        'images': images
                    },
                    'line_number': i + 1
                }

            # Section break
            elif re.match(r'^===+$', line):
                # Mark next slide as section intro
                if current_slide:
                    slides.append(current_slide)
                    current_slide = None

        if current_slide:
            slides.append(current_slide)

        return slides

    def _extract_metrics(self, content: str) -> List[Dict]:
        """Extract key metrics and numbers from content."""
        metrics = []

        # Find numbers with units/symbols
        pattern = r'(\d+\.?\d*)\s*([%$€£¥MKB]?)'
        matches = re.finditer(pattern, content)

        for match in matches:
            value = match.group(1)
            unit = match.group(2)

            # Only include significant numbers (> 10 or with units)
            if float(value) > 10 or unit:
                metrics.append({
                    'value': value,
                    'unit': unit,
                    'context': content[max(0, match.start()-50):min(len(content), match.end()+50)]
                })

        return metrics[:10]  # Top 10 metrics

    def _calculate_stats(self, slides: List[Dict]) -> Dict:
        """Calculate statistics about slide composition."""
        types = {}
        for slide in slides:
            slide_type = slide['type']
            types[slide_type] = types.get(slide_type, 0) + 1

        return {
            'slide_types': types,
            'has_images': any(s['type'] == 'image' for s in slides),
            'has_metrics': any('metrics' in str(s) for s in slides),
            'has_quotes': any(s['type'] == 'quote' for s in slides)
        }

def main():
    if len(sys.argv) < 2:
        print("Usage: python analyze_content.py input.md")
        sys.exit(1)

    input_file = sys.argv[1]

    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            content = f.read()
    except FileNotFoundError:
        print(f"Error: File '{input_file}' not found")
        sys.exit(1)

    analyzer = ContentAnalyzer()
    result = analyzer.analyze(content)

    print(json.dumps(result, indent=2))

if __name__ == '__main__':
    main()
