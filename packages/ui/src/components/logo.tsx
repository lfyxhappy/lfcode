import { ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect data-slot="logo-mark-shadow-body" x="6" y="5" width="4" height="11" fill="var(--icon-weak-base)" />
      <rect data-slot="logo-mark-shadow-foot" x="6" y="12" width="6" height="4" fill="var(--icon-weak-base)" />
      <rect data-slot="logo-mark-body" x="3" y="2" width="4" height="12" fill="var(--icon-strong-base)" />
      <rect data-slot="logo-mark-foot" x="3" y="10" width="8" height="4" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="30" y="26" width="18" height="56" fill="var(--icon-base)" />
      <rect x="30" y="64" width="30" height="18" fill="var(--icon-base)" />
      <rect x="20" y="16" width="18" height="56" fill="var(--icon-strong-base)" />
      <rect x="20" y="54" width="30" height="18" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 190 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g>
        <rect x="7" y="11" width="6" height="20" fill="var(--icon-weak-base)" />
        <rect x="7" y="24" width="12" height="6" fill="var(--icon-weak-base)" />
        <rect x="0" y="4" width="6" height="20" fill="var(--icon-strong-base)" />
        <rect x="0" y="18" width="12" height="6" fill="var(--icon-strong-base)" />
      </g>
      <text
        x="36"
        y="28"
        fill="var(--icon-strong-base)"
        font-family="IBM Plex Sans, IBM Plex Sans JP, Inter, sans-serif"
        font-size="26"
        font-weight="700"
        letter-spacing="0.6"
      >
        Lfcode
      </text>
    </svg>
  )
}
