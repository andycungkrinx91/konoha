# Source Fidelity Directives

> Read when executing `build_with_image_design` or `build_from_source` with mockups or source files.

- Reproduce the source layout, spacing, typography, colors, content hierarchy, and component structure faithfully.
- Do not add generic theme switchers, carousels, dialogs, pages, or decorative sections absent from the source.
- Add only non-structural 3D enhancements that preserve the source: bounded card tilt, opacity/transform entrance motion, and subtle parallax where it cannot change layout.
- Respect `prefers-reduced-motion` and keyboard/focus accessibility.
- Use framework-native routing and validation commands from `build-directives-manifest.md`.
- Keep image loading optimized and never expose secrets.
