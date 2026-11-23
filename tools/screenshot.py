"""Screenshots of the live site at phone size (used to check the 3D map, cameras and satellite)."""
import asyncio
import os
import sys

from playwright.async_api import async_playwright

URL = os.environ.get("SITE", "https://acarcurs.github.io/nieve-vail/")
OUT = sys.argv[1] if len(sys.argv) > 1 else "shots"


async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="es-MX",
                                  timezone_id="America/Mexico_City")
        pg = await ctx.new_page()
        logs = []
        pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}"[:400]) if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: logs.append(f"pageerror: {e}"[:400]))
        pg.on("requestfailed", lambda r: logs.append(f"failed: {r.url[:160]} {r.failure}"))
        for v in ["hoy", "pronostico", "satelite", "historial"]:
            await pg.goto(URL + "#" + v, wait_until="networkidle")
            await pg.wait_for_timeout(2500)
            await pg.screenshot(path=f"{OUT}/{v}.png", full_page=True)
        await pg.goto(URL + "#mapa", wait_until="domcontentloaded")
        await pg.wait_for_timeout(25000)
        await pg.screenshot(path=f"{OUT}/mapa.png", full_page=False)
        box = await pg.query_selector("#mapwrap")
        if box:
            await box.screenshot(path=f"{OUT}/mapa_box.png")
            for view in ("front", "all"):
                await pg.click(f'.mapviews .chip[data-view="{view}"]')
                await pg.wait_for_timeout(9000)
                await box.screenshot(path=f"{OUT}/mapa_{view}.png")
        await pg.goto(URL + "#camaras", wait_until="networkidle")
        await pg.wait_for_timeout(1500)
        btn = await pg.query_selector(".camplay")
        if btn:
            await btn.click()
            await pg.wait_for_timeout(12000)
        await pg.screenshot(path=f"{OUT}/camaras.png", full_page=False)
        open(f"{OUT}/log.txt", "w").write("\n".join(logs))
        await b.close()

asyncio.run(main())
