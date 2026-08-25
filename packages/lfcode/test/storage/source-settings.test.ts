import { describe, expect, test } from "bun:test"
import { clearProjectResearch, getResearchSettings, upsertResearchSettings } from "../../src/research/persistence"
import { chooseSearchRoute } from "../../src/research/routing"
import { ResearchRoutes } from "../../src/server/routes/instance/research"

describe("project research settings", () => {
  test("persists a browser engine and custom template per project", () => {
    const projectID = "research-settings-project"
    clearProjectResearch(projectID)
    expect(getResearchSettings(projectID)).toBeUndefined()

    const bing = upsertResearchSettings(projectID, { browserSearchEngine: "bing" })
    expect(bing.browserSearchEngine).toBe("bing")
    expect(getResearchSettings(projectID)?.browserSearchURLTemplate).toBeUndefined()

    const custom = upsertResearchSettings(projectID, {
      browserSearchEngine: "custom",
      browserSearchURLTemplate: "https://search.example.test/find?q={query}",
    })
    expect(custom.browserSearchEngine).toBe("custom")
    expect(custom.browserSearchURLTemplate).toContain("{query}")

    const route = chooseSearchRoute({
      query: "中文 查询",
      browser: { engine: custom.browserSearchEngine!, template: custom.browserSearchURLTemplate },
    })
    expect(route).toMatchObject({ route: "browser" })
    expect(route.url).toContain("%E4%B8%AD%E6%96%87")
  })

  test("rejects an incomplete custom browser template", () => {
    expect(() => upsertResearchSettings("research-settings-invalid", { browserSearchEngine: "custom" })).toThrow("{query}")
  })

  test("exposes settings through the project research API", async () => {
    const projectID = "research-settings-route"
    clearProjectResearch(projectID)
    const app = ResearchRoutes()
    const empty = await app.request(`http://localhost/settings?projectID=${projectID}`)
    expect(empty.status).toBe(200)
    expect(await empty.json()).toBeNull()

    const saved = await app.request(`http://localhost/settings?projectID=${projectID}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ browserSearchEngine: "baidu" }),
    })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({ projectID, browserSearchEngine: "baidu" })

    const routed = await app.request(`http://localhost/route?projectID=${projectID}&query=%E4%B8%AD%E6%96%87&browserEngine=bing`)
    expect(routed.status).toBe(200)
    expect(await routed.json()).toMatchObject({ route: "browser", url: "https://www.baidu.com/s?wd=%E4%B8%AD%E6%96%87" })

    const invalid = await app.request(`http://localhost/settings?projectID=${projectID}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ browserSearchEngine: "custom" }),
    })
    expect(invalid.status).toBe(400)
  })
})
