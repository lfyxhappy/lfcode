import z from "zod"
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import { Log } from "@/util"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { AsyncQueue } from "@/util/queue"
import { MessageV2 } from "@/session/message-v2"

const log = Log.create({ service: "server" })

function isUserVisibleEvent(event: { type: string; properties: Record<string, unknown> }) {
  if (event.properties.visible === false) return false
  if (event.type === "message.updated") {
    const info = event.properties.info
    return !!info && typeof info === "object" && MessageV2.isUserVisible(info as MessageV2.Info)
  }
  if (event.type === "message.part.updated") {
    const part = event.properties.part
    if (!part || typeof part !== "object" || !("sessionID" in part) || !("messageID" in part)) return false
    return MessageV2.isUserVisibleMessage({
      sessionID: part.sessionID as MessageV2.Info["sessionID"],
      messageID: part.messageID as MessageV2.Info["id"],
    })
  }
  if (event.type === "message.part.delta") {
    if (typeof event.properties.sessionID !== "string" || typeof event.properties.messageID !== "string") return false
    return MessageV2.isUserVisibleMessage({
      sessionID: event.properties.sessionID as MessageV2.Info["sessionID"],
      messageID: event.properties.messageID as MessageV2.Info["id"],
    })
  }
  return true
}

export const EventRoutes = () =>
  new Hono().get(
    "/event",
    describeRoute({
      summary: "Subscribe to events",
      description: "Get events",
      operationId: "event.subscribe",
      responses: {
        200: {
          description: "Event stream",
          content: {
            "text/event-stream": {
              schema: resolver(
                z.union(BusEvent.payloads()).meta({
                  ref: "Event",
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      log.info("event connected")
      c.header("Cache-Control", "no-cache, no-transform")
      c.header("X-Accel-Buffering", "no")
      c.header("X-Content-Type-Options", "nosniff")
      return streamSSE(c, async (stream) => {
        const q = new AsyncQueue<string | null>()
        let done = false

        q.push(
          JSON.stringify({
            type: "server.connected",
            properties: {},
          }),
        )

        // Send heartbeat every 10s to prevent stalled proxy streams.
        const heartbeat = setInterval(() => {
          q.push(
            JSON.stringify({
              type: "server.heartbeat",
              properties: {},
            }),
          )
        }, 10_000)

        const stop = () => {
          if (done) return
          done = true
          clearInterval(heartbeat)
          unsub()
          q.push(null)
          log.info("event disconnected")
        }

        const unsub = Bus.subscribeAll((event) => {
          if (!isUserVisibleEvent(event)) return
          q.push(JSON.stringify(event))
          if (event.type === Bus.InstanceDisposed.type) {
            stop()
          }
        })

        stream.onAbort(stop)

        try {
          for await (const data of q) {
            if (data === null) return
            await stream.writeSSE({ data })
          }
        } finally {
          stop()
        }
      })
    },
  )
