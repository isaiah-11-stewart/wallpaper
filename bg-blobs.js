/**
 * Bouncing team logos wallpaper.
 * Config: window.__BG_BLOBS__ = { mode: "logos", logos: [{ url, invert? }, ...] }
 *
 * Each logo is trimmed to opaque pixels, scaled so max side = LOGO_MAX_PX,
 * then drawn into a LOGO_MAX_PX square. Display + alpha mask share that canvas.
 *
 * Collisions use alpha borders:
 * - Walls: opaque pixel AABB vs viewport edges
 * - Logo–logo: circle broadphase + pixel-mask overlap, equal-mass elastic bounce
 */
(function () {
    var LOGO_MAX_PX = 100;
    var BLOB = {
        /* px traveled per second (each item gets ± this on x and y → diagonal) */
        speedPxPerSec: 10,
    };

    var page = window.__BG_BLOBS__ || {};
    var logoMode = page.mode === "logos";
    var logoEntries = (page.logos || [])
        .map(function (entry) {
            if (typeof entry === "string") return { url: entry, invert: false };
            return {
                url: entry && entry.url,
                invert: !!(entry && entry.invert),
                id: entry && entry.id,
            };
        })
        .filter(function (entry) {
            return !!entry.url;
        });

    if (!logoMode || !logoEntries.length) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    var speed = BLOB.speedPxPerSec;

    var layer = document.createElement("div");
    layer.className = "bg-blobs bg-blobs--logos";
    layer.setAttribute("aria-hidden", "true");
    document.body.prepend(layer);

    function randSign() {
        return Math.random() < 0.5 ? -1 : 1;
    }

    function fallbackHit(box) {
        return {
            dataUrl: null,
            mask: null,
            hit: box,
            bounds: { minX: 0, maxX: box - 1, minY: 0, maxY: box - 1 },
            box: box,
        };
    }

    /**
     * Trim transparent padding, scale so the longer opaque side = maxPx,
     * redraw into a maxPx×maxPx canvas, and build the alpha mask from that.
     */
    function normalizeLogo(img, maxPx, invert) {
        if (!img.naturalWidth || !img.naturalHeight) return fallbackHit(maxPx);

        var src = document.createElement("canvas");
        src.width = img.naturalWidth;
        src.height = img.naturalHeight;
        var sctx = src.getContext("2d", { willReadFrequently: true });
        if (!sctx) return fallbackHit(maxPx);

        try {
            sctx.drawImage(img, 0, 0);
        } catch (e) {
            return fallbackHit(maxPx);
        }

        var srcData;
        try {
            srcData = sctx.getImageData(0, 0, src.width, src.height).data;
        } catch (e) {
            return fallbackHit(maxPx);
        }

        var minX = src.width;
        var minY = src.height;
        var maxX = -1;
        var maxY = -1;
        var x, y, a;
        for (y = 0; y < src.height; y++) {
            for (x = 0; x < src.width; x++) {
                a = srcData[(y * src.width + x) * 4 + 3];
                if (a === 0) continue;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
        if (maxX < 0) return fallbackHit(maxPx);

        var cropW = maxX - minX + 1;
        var cropH = maxY - minY + 1;
        var scale = Math.min(maxPx / cropW, maxPx / cropH);
        var dw = Math.max(1, Math.round(cropW * scale));
        var dh = Math.max(1, Math.round(cropH * scale));
        var dx = Math.floor((maxPx - dw) / 2);
        var dy = Math.floor((maxPx - dh) / 2);

        var out = document.createElement("canvas");
        out.width = maxPx;
        out.height = maxPx;
        var octx = out.getContext("2d", { willReadFrequently: true });
        if (!octx) return fallbackHit(maxPx);

        octx.clearRect(0, 0, maxPx, maxPx);
        if (invert) {
            /* Draw black silhouette then invert → white mark on transparent. */
            octx.filter = "brightness(0) invert(1)";
        }
        octx.drawImage(img, minX, minY, cropW, cropH, dx, dy, dw, dh);
        octx.filter = "none";

        var data;
        try {
            data = octx.getImageData(0, 0, maxPx, maxPx).data;
        } catch (e) {
            return fallbackHit(maxPx);
        }

        var mask = new Uint8Array(maxPx * maxPx);
        var cx = (maxPx - 1) / 2;
        var cy = (maxPx - 1) / 2;
        var maxDist = 0;
        var bMinX = maxPx;
        var bMinY = maxPx;
        var bMaxX = -1;
        var bMaxY = -1;
        var dist, idx;

        for (y = 0; y < maxPx; y++) {
            for (x = 0; x < maxPx; x++) {
                a = data[(y * maxPx + x) * 4 + 3];
                if (a === 0) continue;
                idx = y * maxPx + x;
                mask[idx] = 1;
                dist = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
                if (dist > maxDist) maxDist = dist;
                if (x < bMinX) bMinX = x;
                if (x > bMaxX) bMaxX = x;
                if (y < bMinY) bMinY = y;
                if (y > bMaxY) bMaxY = y;
            }
        }

        if (bMaxX < 0) return fallbackHit(maxPx);

        return {
            dataUrl: out.toDataURL("image/png"),
            mask: mask,
            hit: maxDist > 0 ? maxDist * 2 : maxPx,
            bounds: { minX: bMinX, maxX: bMaxX, minY: bMinY, maxY: bMaxY },
            box: maxPx,
        };
    }

    function loadImage(url, done) {
        var img = new Image();
        img.onload = function () {
            done(img);
        };
        img.onerror = function () {
            done(null);
        };
        /* crossOrigin lets remote ESPN canvases be read; harmless for local files. */
        img.crossOrigin = "anonymous";
        img.src = url;
    }

    function makeItems() {
        return logoEntries.map(function (entry) {
            var el = document.createElement("img");
            el.className = "bg-blob bg-blob--logo";
            el.alt = entry.id || "";
            el.draggable = false;
            /* Placeholder until normalize swaps in the trimmed data URL. */
            el.width = LOGO_MAX_PX;
            el.height = LOGO_MAX_PX;
            layer.appendChild(el);
            return {
                el: el,
                url: entry.url,
                invert: entry.invert,
                cx: 0,
                cy: 0,
                vx: 0,
                vy: 0,
                box: LOGO_MAX_PX,
                hit: LOGO_MAX_PX,
                mask: null,
                bounds: null,
            };
        });
    }

    var items = makeItems();

    function paint(b) {
        var half = b.box / 2;
        b.el.style.transform =
            "translate(" + (b.cx - half) + "px, " + (b.cy - half) + "px)";
    }

    function readBox(b) {
        b.box = b.el.offsetWidth || b.box || LOGO_MAX_PX;
        return b.box;
    }

    function ensureBounds(b) {
        if (b.bounds) return b.bounds;
        var box = b.box || LOGO_MAX_PX;
        b.bounds = { minX: 0, maxX: Math.max(0, box - 1), minY: 0, maxY: Math.max(0, box - 1) };
        return b.bounds;
    }

    function opaqueWorldBounds(b) {
        var bounds = ensureBounds(b);
        var left = b.cx - b.box / 2;
        var top = b.cy - b.box / 2;
        return {
            minX: left + bounds.minX,
            maxX: left + bounds.maxX,
            minY: top + bounds.minY,
            maxY: top + bounds.maxY,
        };
    }

    function maskOpaqueAt(b, worldX, worldY) {
        if (!b.mask) return false;
        var lx = Math.floor(worldX - (b.cx - b.box / 2));
        var ly = Math.floor(worldY - (b.cy - b.box / 2));
        if (lx < 0 || ly < 0 || lx >= b.box || ly >= b.box) return false;
        return b.mask[ly * b.box + lx] !== 0;
    }

    function pixelsOverlap(a, b) {
        if (!a.mask || !b.mask) {
            var dx = b.cx - a.cx;
            var dy = b.cy - a.cy;
            var minDist = (a.hit + b.hit) / 2;
            return dx * dx + dy * dy < minDist * minDist;
        }

        var ax0 = a.cx - a.box / 2;
        var ay0 = a.cy - a.box / 2;
        var bx0 = b.cx - b.box / 2;
        var by0 = b.cy - b.box / 2;
        var x0 = Math.max(ax0, bx0);
        var y0 = Math.max(ay0, by0);
        var x1 = Math.min(ax0 + a.box, bx0 + b.box);
        var y1 = Math.min(ay0 + a.box, by0 + b.box);
        if (x0 >= x1 || y0 >= y1) return false;

        var x, y;
        for (y = Math.floor(y0); y < y1; y++) {
            for (x = Math.floor(x0); x < x1; x++) {
                if (maskOpaqueAt(a, x, y) && maskOpaqueAt(b, x, y)) return true;
            }
        }
        return false;
    }

    function overlapsPlaced(b, placed, gap) {
        var i, o, dx, dy, minDist;
        for (i = 0; i < placed.length; i++) {
            o = placed[i];
            dx = b.cx - o.cx;
            dy = b.cy - o.cy;
            minDist = (b.hit + o.hit) / 2 + gap;
            if (dx * dx + dy * dy >= minDist * minDist) continue;
            if (pixelsOverlap(b, o)) return true;
        }
        return false;
    }

    function playArea() {
        return {
            w: document.documentElement.clientWidth,
            h: document.documentElement.clientHeight,
        };
    }

    function layout() {
        var area = playArea();
        var w = area.w;
        var h = area.h;
        var placed = [];
        var gap = 1;
        var maxAttempts = 80;

        items.forEach(function (b) {
            readBox(b);
            if (!b.hit) b.hit = b.box;
            ensureBounds(b);

            if (!b.vx && !b.vy) {
                var ok = false;
                var attempt;
                var ow = opaqueWorldBounds(b);
                var halfW = (ow.maxX - ow.minX) / 2;
                var halfH = (ow.maxY - ow.minY) / 2;
                var centerOffsetX = (ow.minX + ow.maxX) / 2 - b.cx;
                var centerOffsetY = (ow.minY + ow.maxY) / 2 - b.cy;
                var minX = halfW - centerOffsetX;
                var maxX = w - halfW - centerOffsetX;
                var minY = halfH - centerOffsetY;
                var maxY = h - halfH - centerOffsetY;
                var spanX = Math.max(0, maxX - minX);
                var spanY = Math.max(0, maxY - minY);

                for (attempt = 0; attempt < maxAttempts; attempt++) {
                    b.cx = minX + Math.random() * spanX;
                    b.cy = minY + Math.random() * spanY;
                    if (!overlapsPlaced(b, placed, gap)) {
                        ok = true;
                        break;
                    }
                }
                if (!ok) {
                    b.cx = minX + Math.random() * spanX;
                    b.cy = minY + Math.random() * spanY;
                }
                b.vx = speed * randSign();
                b.vy = speed * randSign();
                placed.push(b);
            } else {
                bounceWalls(b, w, h);
            }
            paint(b);
        });
    }

    function bounceWalls(b, w, h) {
        var ow = opaqueWorldBounds(b);

        if (ow.minX < 0) {
            b.cx -= ow.minX;
            b.vx = Math.abs(b.vx);
            ow = opaqueWorldBounds(b);
        } else if (ow.maxX > w - 1) {
            b.cx -= ow.maxX - (w - 1);
            b.vx = -Math.abs(b.vx);
            ow = opaqueWorldBounds(b);
        }

        if (ow.minY < 0) {
            b.cy -= ow.minY;
            b.vy = Math.abs(b.vy);
        } else if (ow.maxY > h - 1) {
            b.cy -= ow.maxY - (h - 1);
            b.vy = -Math.abs(b.vy);
        }
    }

    function collidePair(a, b) {
        var dx = b.cx - a.cx;
        var dy = b.cy - a.cy;
        var distSq = dx * dx + dy * dy;
        var minDist = (a.hit + b.hit) / 2;
        if (distSq === 0 || distSq >= minDist * minDist) return;
        if (!pixelsOverlap(a, b)) return;

        var dist = Math.sqrt(distSq);
        var nx = dx / dist;
        var ny = dy / dist;
        var dvx = a.vx - b.vx;
        var dvy = a.vy - b.vy;
        var dvn = dvx * nx + dvy * ny;
        if (dvn > 0) {
            a.vx -= dvn * nx;
            a.vy -= dvn * ny;
            b.vx += dvn * nx;
            b.vy += dvn * ny;
        }

        var step;
        for (step = 0; step < 24 && pixelsOverlap(a, b); step++) {
            a.cx -= 0.5 * nx;
            a.cy -= 0.5 * ny;
            b.cx += 0.5 * nx;
            b.cy += 0.5 * ny;
        }
    }

    function resolveLogoCollisions() {
        var i, j;
        for (i = 0; i < items.length; i++) {
            for (j = i + 1; j < items.length; j++) {
                collidePair(items[i], items[j]);
            }
        }
    }

    var last = performance.now();

    function tick(now) {
        var dt = Math.min(0.05, (now - last) / 1000);
        last = now;

        var area = playArea();
        var w = area.w;
        var h = area.h;

        items.forEach(function (b) {
            readBox(b);
            b.cx += b.vx * dt;
            b.cy += b.vy * dt;
            bounceWalls(b, w, h);
        });

        resolveLogoCollisions();
        items.forEach(function (b) {
            bounceWalls(b, w, h);
        });

        items.forEach(paint);
        requestAnimationFrame(tick);
    }

    function prepareLogos(done) {
        var pending = items.length;
        if (!pending) {
            done();
            return;
        }

        items.forEach(function (b) {
            loadImage(b.url, function (img) {
                if (!img) {
                    b.el.remove();
                    items = items.filter(function (x) {
                        return x !== b;
                    });
                    pending -= 1;
                    if (!pending) done();
                    return;
                }

                var result = normalizeLogo(img, LOGO_MAX_PX, b.invert);
                b.hit = result.hit;
                b.mask = result.mask;
                b.bounds = result.bounds;
                b.box = result.box;

                if (result.dataUrl) {
                    b.el.onload = function () {
                        pending -= 1;
                        if (!pending) done();
                    };
                    b.el.src = result.dataUrl;
                } else {
                    b.el.src = b.url;
                    pending -= 1;
                    if (!pending) done();
                }
            });
        });
    }

    function start() {
        layout();
        window.addEventListener("resize", layout);
        requestAnimationFrame(tick);
    }

    prepareLogos(start);
})();
