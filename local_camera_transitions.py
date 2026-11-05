"""Original local transition effects inspired by the inspected CapCut timeline.

These are independent recreations, not CapCut assets or identical shaders.
Audio and clip timing are handled by the existing finishing pipeline.
"""
import numpy as np


def transition_frame(old, new, progress, effect):
    p = float(np.clip(progress, 0, 1))
    if p <= 0:
        return old
    if p >= 1:
        return new
    h, w = new.shape[:2]
    y, x = np.ogrid[:h, :w]
    xx = (x / max(w - 1, 1) - .5) * 2
    yy = (y / max(h - 1, 1) - .5) * 2
    radius = np.sqrt(xx * xx + yy * yy)
    angle = np.arctan2(yy, xx)
    pulse = np.sin(np.pi * p)

    def warp(frame, dx=0, dy=0, twist=0, zoom=1):
        # Edge-clamped sampling avoids black or wrapped borders.
        a = twist * np.exp(-radius * radius)
        sx = (xx * np.cos(a) - yy * np.sin(a)) / zoom
        sy = (xx * np.sin(a) + yy * np.cos(a)) / zoom
        ix = np.clip(((sx + 1) * .5 * (w - 1) + dx).astype(int), 0, w - 1)
        iy = np.clip(((sy + 1) * .5 * (h - 1) + dy).astype(int), 0, h - 1)
        return frame[iy, ix]

    field = np.broadcast_to(xx, (h, w))
    threshold = -1 + 2 * p
    feather = .08
    brightness = 0
    if effect == 'wavy_change':
        field = xx + .2 * np.sin(yy * 10 + p * 8) * pulse
    elif effect == 'glare_ii':
        alpha = p
        brightness = 180 * pulse ** 4
        return np.clip(old.astype(float) * (1-alpha) + new.astype(float) * alpha + brightness, 0, 255).astype(new.dtype)
    elif effect in ('fuzzy_love_wipe', 'heart_shot'):
        # Implicit heart silhouette expanding from the centre.
        scale = max(.01, 2.8 * p)
        hx, hy = xx / scale, -yy / scale
        field = (hx*hx + hy*hy - 1)**3 - hx*hx*hy**3
        threshold = 0
        feather = .4 if effect == 'fuzzy_love_wipe' else .05
    elif effect == 'wave_swirl':
        old = warp(old, twist=2.5*pulse)
        new = warp(new, twist=-1.5*pulse)
        field = radius + .12*np.sin(angle*5+p*12)
        threshold = 1.7*p
    elif effect == 'line_spiral':
        field = (angle + np.pi) / (2*np.pi) + radius*.65
        threshold = 1.95*p
        feather = .04
    elif effect == 'uneven_spread':
        field = radius + .14*np.sin(angle*7) + .09*np.cos(xx*19+yy*13)
        threshold = 1.8*p
    elif effect == 'ring_wipe':
        field = radius
        threshold = 1.5*p
        brightness = 75*np.exp(-((radius-threshold)/.035)**2)*pulse
    elif effect == 'vibration_amped':
        old = warp(old, dx=w*.035*pulse*np.sin(p*70), dy=h*.018*pulse*np.cos(p*55), zoom=1+.08*pulse)
        new = warp(new, dx=-w*.025*pulse*np.sin(p*70), zoom=1+.06*pulse)
        field = np.full((h,w), 1-2*p)
        threshold = 0
        feather = .5
    elif effect == 'click_to_expand':
        new = warp(new, zoom=1+.3*(1-p))
        field = np.maximum(np.abs(xx),np.abs(yy))
        threshold = p*1.05
        feather = .025
    elif effect == 'gel_hole':
        old = warp(old, twist=.5*pulse, zoom=1+.25*pulse)
        field = radius + .1*np.sin(angle*6+p*15)*pulse
        threshold = 1.6*p
    else:
        raise ValueError('Unknown local transition: '+str(effect))
    alpha = np.clip((threshold-field)/feather*.5+.5,0,1)[...,None]
    frame = old.astype(float)*(1-alpha)+new.astype(float)*alpha
    if np.ndim(brightness):
        frame += brightness[...,None]
    return np.clip(frame,0,255).astype(new.dtype)
