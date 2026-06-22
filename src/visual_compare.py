#!/usr/bin/env python3
"""Helper script to visually compare two images pixel-by-pixel."""
import sys
import os
import json
from PIL import Image, ImageChops, ImageDraw

def compare_images(img1_path, img2_path, diff_path=None, threshold=10):
    try:
        if not os.path.exists(img1_path):
            return {"error": f"Image 1 not found: {img1_path}"}
        if not os.path.exists(img2_path):
            return {"error": f"Image 2 not found: {img2_path}"}

        img1 = Image.open(img1_path).convert('RGB')
        img2 = Image.open(img2_path).convert('RGB')

        # Resize img2 to match img1 if dimensions differ
        if img1.size != img2.size:
            img2 = img2.resize(img1.size, Image.Resampling.LANCZOS)

        diff = ImageChops.difference(img1, img2)
        bbox = diff.getbbox()
        
        mismatched_pixels = 0
        total_pixels = img1.size[0] * img1.size[1]
        
        if diff_path:
            diff_img = Image.new('RGB', img1.size, (255, 255, 255))
            pixels1 = img1.load()
            pixels2 = img2.load()
            diff_pixels = diff_img.load()
            
            for y in range(img1.size[1]):
                for x in range(img1.size[0]):
                    r1, g1, b1 = pixels1[x, y]
                    r2, g2, b2 = pixels2[x, y]
                    dist = abs(r1-r2) + abs(g1-g2) + abs(b1-b2)
                    if dist > threshold * 3:
                        mismatched_pixels += 1
                        diff_pixels[x, y] = (255, 0, 0) # Red for mismatch
                    else:
                        # Grayscale faded background for matching pixels
                        gray = int(0.299*r1 + 0.587*g1 + 0.114*b1)
                        # Blend to make it lighter
                        val = int(gray * 0.4 + 150)
                        diff_pixels[x, y] = (val, val, val)
            
            diff_img.save(diff_path)
        else:
            pixels1 = img1.load()
            pixels2 = img2.load()
            for y in range(img1.size[1]):
                for x in range(img1.size[0]):
                    r1, g1, b1 = pixels1[x, y]
                    r2, g2, b2 = pixels2[x, y]
                    if abs(r1-r2) + abs(g1-g2) + abs(b1-b2) > threshold * 3:
                        mismatched_pixels += 1

        similarity = (total_pixels - mismatched_pixels) / total_pixels * 100
        
        return {
            "width": img1.size[0],
            "height": img1.size[1],
            "total_pixels": total_pixels,
            "mismatched_pixels": mismatched_pixels,
            "similarity_percentage": round(similarity, 4),
            "match_100_percent": mismatched_pixels == 0,
            "bbox_diff": list(bbox) if bbox else None
        }

    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: visual_compare.py <img1> <img2> [diff_output] [threshold]"}))
        sys.exit(1)
        
    img1 = sys.argv[1]
    img2 = sys.argv[2]
    diff = sys.argv[3] if len(sys.argv) > 3 else None
    thresh = int(sys.argv[4]) if len(sys.argv) > 4 else 10
    
    res = compare_images(img1, img2, diff, thresh)
    print(json.dumps(res))
