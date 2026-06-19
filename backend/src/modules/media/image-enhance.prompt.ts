/**
 * Prompt sent to Gemini for real-estate listing image enhancement.
 *
 * Rules: enhance lighting/colors/sharpness, fix perspective, remove small
 * distractions — but NEVER add, fabricate, or alter objects/views.
 */
export const IMAGE_ENHANCE_PROMPT = `Edit this real estate listing photo. Follow these rules with absolute strictness:

STRICT PROHIBITIONS — violations of these make the output unusable:
- Do NOT add, generate, or fabricate ANY objects, furniture, fixtures, windows, doors, or architectural elements that do not exist in the original photo.
- Do NOT remove or replace ANY structural elements: floors, walls, ceilings, tiles, countertops, windows, doors, railings, pillars must remain EXACTLY as they appear.
- Do NOT change ANY material or texture: marble stays marble, wood stays wood, ceramic stays ceramic, concrete stays concrete. The exact pattern, color, and material of every surface must be preserved.
- Do NOT alter, replace, or fabricate the view outside any window. Leave exterior views exactly as-is, even if overexposed or dark.
- Do NOT add light sources that are not already present.
- Do NOT change the color temperature of any existing light fixture.
- Do NOT remove or alter any fixed furniture or built-in elements.

ALLOWED ENHANCEMENTS ONLY:
1. Lighting: Brighten the room to simulate natural daylight flooding in. Reduce harsh shadows. Every corner should be well-lit. Existing light fixtures should appear turned on with their original color temperature preserved.
2. Color correction: Fix white balance issues. Whites should look white in daylit areas. Preserve the true color of all surfaces and materials.
3. Perspective: Straighten tilted angles. Walls vertical, floors level. Correct mild wide-angle distortion.
4. Minor cleanup: Remove only small temporary distractions — visible cables, dust spots, minor wall smudges, smudges on glass/mirrors. Do NOT remove any furniture, appliances, or fixtures.
5. Sharpness: Enhance detail and crispness on all surfaces. The result should look professionally photographed.

OUTPUT: 4:3 aspect ratio (landscape). Crop intelligently without stretching.

The result must look like the SAME room photographed by a professional with proper lighting — not a different room. Every architectural detail, material, and fixture must be identical to the original.`;
