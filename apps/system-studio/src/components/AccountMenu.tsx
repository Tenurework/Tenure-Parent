"use client"

import { useEffect, useState } from "react"

import { Button, Menu, type MenuGroup } from "./md3"
import type { OperatorRole } from "@/lib/operators"

import styles from "./topbar.module.css"

/**
 * STUDIO-030-003 / STUDIO-030-007 — the top bar's two interactive controls.
 *
 * ## Why two components share one module
 *
 * `TopBar` is a Server Component: it awaits `auth()`, reads the estate through
 * the AWS SDK, and declares the `"use server"` action that ends the session.
 * Neither control below can live there — a menu that opens and a keyboard
 * listener are client behaviour, and `"use server"` and `"use client"` cannot
 * share a module. This file is the top bar's client half.
 *
 * ## The menu behaviour is NOT written here
 *
 * `components/md3/Menu` is the console's menu-button primitive, and it owns the
 * whole ARIA Authoring Practices model: roving `tabIndex`, ArrowDown opening
 * onto the first enabled item and ArrowUp onto the LAST, wrap-around, type-
 * ahead, `Escape` closing and returning focus to the trigger, `Tab` closing
 * without trapping, and a layer stack so a menu inside a dialog dismisses one
 * level at a time. Every one of those is a thing an account dropdown
 * reimplements badly, which is why the requirement asks for a primitive and not
 * for a dropdown.
 *
 * This file therefore contributes DATA — who is signed in, which role, what the
 * estate is, and what signing out does — and the primitive contributes the
 * behaviour. If the account menu's keyboard model is ever wrong, it is wrong in
 * `components/md3/Menu.tsx` for every menu in the console at once, which is the
 * point.
 *
 * ## Sign-out
 *
 * `signOutAction` is a server action declared in `TopBar`. Invoking it from
 * here is a POST to the server, which is where the session cookie lives: it is
 * `httpOnly`, so no code running in this page could clear it even if it tried.
 * In Cognito mode the same action then redirects to the user pool's federated
 * logout, so the hosted UI does not sign the same person straight back in.
 */

export interface AccountMenuProps {
  /** The address in the session. Never empty — `TopBar` renders nothing if it is. */
  email: string
  /**
   * The family this address belongs to, or null.
   *
   * Null is a real state and not an error: an operator whose address was
   * removed from `PLATFORM_OPERATORS` still holds a valid session cookie until
   * it expires. `roleOf` returns null for them and every surface refuses them,
   * so the menu says so plainly and offers the one thing that still works.
   */
  role: OperatorRole | null
  /** The same role, as it reads in a sentence. Null when `role` is. */
  roleName: string | null
  /** `AWS <account> · <region>`, or the same shape carrying UNKNOWN. */
  estateSummary: string
  /** What was read from `sts:GetCallerIdentity`, or why it could not be. */
  estateDetail: string
  /** True when sign-out will also end the identity provider's session. */
  federated: boolean
  /** The server action that ends the session. Declared in `TopBar`. */
  signOutAction: () => Promise<void>
}

export function AccountMenu({
  email,
  role,
  roleName,
  estateSummary,
  estateDetail,
  federated,
  signOutAction,
}: AccountMenuProps) {
  /*
    Three groups, and the third exists because of STUDIO-030-004: the
    irreversible-feeling control does not sit flush against the ordinary ones.
    Sign-out destroys no data, but it is the control an operator hits by
    accident when it is one row under a navigation link — so it is in its own
    group, carries the danger tone, and says what it will do.
  */
  const groups: MenuGroup[] = [
    {
      key: "session",
      label: `Signed in as ${email}`,
      items: [
        {
          key: "role",
          /*
            The role is shown because five families exist and they hold
            different grants (`OPERATOR_GRANTS` in `lib/operators.ts`). An
            operator who cannot see which family they are in cannot predict
            which controls will refuse them, and reads a correct refusal as a
            broken console.
          */
          label: roleName ?? "No operator role",
          detail: role
            ? `PLATFORM_OPERATORS carries "${email}:${role}"`
            : "This address is not in PLATFORM_OPERATORS. Every surface refuses it; only sign-out still works.",
          disabled: true,
        },
        {
          key: "estate",
          label: estateSummary,
          detail: estateDetail,
          disabled: true,
        },
      ],
    },
    /*
      Two destinations, both routes this console already serves: who may sign in
      and as what, and the account those permissions are exercised against. No
      invented links — a menu entry pointing at a route that does not exist is a
      404 an operator finds for us. Offered only to an address that still holds
      a role, because both pages refuse anybody else.
    */
    ...(role
      ? [
          {
            key: "go",
            label: "Go to",
            items: [
              {
                key: "identity",
                label: "Operator access",
                href: "/platform/identity",
                detail: "who may sign in to this console, and as what",
              },
              {
                key: "estate-page",
                label: "Estate",
                href: "/platform/estate",
                detail: "what is running in this account right now",
              },
            ],
          } satisfies MenuGroup,
        ]
      : []),
    {
      key: "end-session",
      items: [
        {
          key: "sign-out",
          label: "Sign out",
          tone: "danger",
          detail: federated
            ? "ends this session and signs out of the identity provider"
            : "ends this session on the server",
          onSelect: () => {
            // Deliberately not awaited: the action redirects, and awaiting it
            // inside a menu handler would hold the closed menu's last render
            // alive for the round trip.
            void signOutAction()
          },
        },
      ],
    },
  ]

  return (
    <div className={styles.account}>
      <Menu
        label="Account"
        // Anchored to its trailing edge, because the trigger is the last thing
        // in the bar and a menu that opens leading-edge-first runs off screen.
        align="end"
        trigger={
          <>
            <span className={styles.accountEmail}>{email}</span>
            <span className={styles.accountRole}>{roleName ?? "no operator role"}</span>
          </>
        }
        groups={groups}
      />
    </div>
  )
}

/* ── Global search ─────────────────────────────────────────────────────────
 *
 * The palette this opens is `components/CommandPalette`, mounted once in
 * `app/layout.tsx` by `components/Launcher`. It has ranked results, pins,
 * recents and focus restoration, and it has been invisible since it shipped:
 * Ctrl/Cmd-K, and nothing on screen that says so. The operator's word for the
 * console was "isolated ... with no ... global search"; the search existed and
 * could not be found, which amounts to the same thing.
 *
 * So this is a TRIGGER, not a second palette. It synthesises the shortcut the
 * palette already listens for on `document`, which leaves exactly one open path
 * and one piece of open state. The alternative — lifting the palette's `open`
 * into a context — edits a file this change does not own, and would give the
 * console two ways to open one dialog and two places for that state to be
 * wrong.
 *
 * The button takes focus before dispatching, deliberately: the palette records
 * `document.activeElement` as the element to restore focus to when it closes,
 * so Escape lands back on this trigger rather than on `<body>`. Firefox and
 * Safari do not focus a button on click, so without that line the shortcut and
 * the button would behave differently on two of three engines.
 */

export function SearchTrigger() {
  /*
    Rendered as "Ctrl K" on the server and corrected after mount, because the
    server has no idea what the operator is typing on and a value read from a
    request header would be a guess. Two renders, one of which nobody sees,
    beats a hydration mismatch React resolves by throwing the markup away.
  */
  const [mac, setMac] = useState(false)
  useEffect(() => {
    setMac(/Mac|iPhone|iPad|iPod/i.test(navigator.userAgent))
  }, [])

  return (
    <Button
      data-search-trigger="true"
      variant="outlined"
      // Announced by a screen reader as the key that reaches this from
      // anywhere, which is the whole reason the shortcut was worth surfacing.
      aria-keyshortcuts="Control+K Meta+K"
      onClick={(event) => {
        event.currentTarget.focus()
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "k",
            // `ctrlKey` on every platform: the palette accepts either modifier,
            // so sending the one that is true everywhere keeps this off the
            // user-agent sniff above, which is cosmetic.
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        )
      }}
    >
      <span className={styles.searchLabel}>Search this console</span>
      <span className={styles.shortcut} aria-hidden="true">
        <kbd className={styles.key}>{mac ? "⌘" : "Ctrl"}</kbd>
        <kbd className={styles.key}>K</kbd>
      </span>
    </Button>
  )
}
