"""Load the live site in WebKit with an iPhone profile (Safari engine) and log errors + what renders."""
import asyncio, sys
from playwright.async_api import async_playwright
URL = "https://acarcurs.github.io/nieve-vail/"
OUT = sys.argv[1] if len(sys.argv) > 1 else "shots"
async def main():
    async with async_playwright() as p:
        b = await p.webkit.launch()
        ctx = await b.new_context(**p.devices["iPhone 13"])
        pg = await ctx.new_page()
        logs = []
        pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}"[:400]) if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: logs.append(f"pageerror: {e}"[:600]))
        pg.on("requestfailed", lambda r: logs.append(f"failed: {r.url[:160]} {r.failure}"))
        await pg.goto(URL, wait_until="load", timeout=60000)
        await pg.wait_for_timeout(6000)
        for v in ["hoy", "historial"]:
            await pg.goto(URL + "#" + v); await pg.wait_for_timeout(2500)
            await pg.screenshot(path=f"{OUT}/webkit_{v}.png")
        logs.append("TEXT: " + (await pg.inner_text("main"))[:300].replace("\n", " | "))
        open(f"{OUT}/webkit_log.txt", "w").write("\n".join(logs))
        await b.close()
asyncio.run(main())
