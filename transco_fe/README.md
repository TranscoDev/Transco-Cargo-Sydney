# Transco Console

# TRANSCO — Frontend UI Only

Build the frontend UI for a staff-facing WhatsApp customer conversation management application called **Transco**.

## IMPORTANT SCOPE

This task is **FRONTEND ONLY**.

Do NOT build or assume any real backend.

Do NOT create:

* MongoDB

* Express/API routes

* WebSocket servers

* WhatsApp integrations

* Flowise integrations

* backend authentication

* backend database models

* backend services

* backend APIs

The frontend will later be connected to an existing backend by another coding agent.

For now, make the application fully functional using realistic mock/local data and local UI state.

The final frontend should be clean enough that another developer can later replace the mock data layer with real REST/WebSocket data without redesigning the UI.

---

# PRODUCT

Transco is a customer conversation console for managing WhatsApp conversations.

There are two modes for each conversation:

* CHATBOT

* HUMAN

The application is primarily designed around one question:

> Which conversations need staff attention?

The interface should feel like a focused WhatsApp-style conversation console, NOT a generic admin dashboard.

---

# PAGES

There should be only two primary pages:

1. Login

2. Conversation Console

Do not add unnecessary dashboards, analytics pages, reports, customer-management pages, settings pages, or other navigation.

---

# PAGE 1 — LOGIN

Create a polished login page.

Include:

* Transco branding

* Email input

* Password input

* Login button

* Appropriate validation states

* Loading state

* Error state

Since there is no backend yet, the login can use mock authentication/local state.

After successful login, navigate to the conversation console.

The design should be professional, modern, minimal, and suitable for an internal customer-support application.

---

# PAGE 2 — CONVERSATION CONSOLE

The main application should use a two-panel layout.

## LEFT PANEL — CONTACT / CONVERSATION LIST

This is the conversation list.

Each conversation card should contain:

* Customer name

* Latest message preview

* Latest message time

* Current mode

* Unread message count when applicable

Example:

John Silva

"Where is my order?"

10:42 AM

CHATBOT

Or:

Sarah Perera

"I need help with my order"

10:39 AM

HUMAN

● 3

---

# HUMAN MODE VISUAL DESIGN

When a customer is in HUMAN mode:

* Highlight the conversation card with a subtle yellow treatment.

* Use yellow as the consistent visual language for human-handled conversations.

* Do not make the entire UI aggressively yellow.

* Keep it subtle, polished, and professional.

The yellow should communicate:

> A human is currently handling this conversation.

CHATBOT conversations should use the normal/default appearance.

Do not use "AI" anywhere in the UI.

Use the word:

**CHATBOT**

---

# UNREAD MESSAGE BADGE

Unread messages should behave visually like WhatsApp.

Show a circular unread badge containing the number of unread customer messages.

Examples:

● 1

● 3

● 12

The badge should only appear when unread customer messages exist.

The unread count represents:

> Number of unread incoming customer messages.

Do not count chatbot or human messages as unread customer messages.

---

# CONTACT ORDER

The conversation list must always be sorted by latest conversation activity.

The conversation with the newest message/activity must appear at the top.

Example:

1. Sarah — 10:45

2. John — 10:41

3. Mike — 10:36

4. David — 10:22

When a new message arrives for an existing customer, that conversation should automatically move to the top.

Implement this using local mock state for now.

---

# CHAT PANEL

When a conversation is selected, display:

* Customer name

* Customer phone number where appropriate

* Conversation history

* Message input

* Send button

Do NOT put a large CHATBOT/HUMAN status badge in the chat header.

Instead, communicate HUMAN mode through the conversation's visual treatment.

---

# HUMAN MODE CHAT APPEARANCE

When the selected conversation is in HUMAN mode:

* Give the entire chat area a very subtle yellow-tinted background.

* Give the chat area a subtle yellow border.

* Human-sent messages should also have a subtle yellow visual treatment.

* Keep the design elegant and restrained.

The purpose is to create visual consistency between:

CONTACT CARD → HUMAN MODE → CHAT BACKGROUND → HUMAN MESSAGE

When the conversation is in CHATBOT mode:

* Use the normal/default chat background.

* Remove the yellow border/tint.

---

# MODE SWITCH

Provide a clear control for switching between:

CHATBOT

and

HUMAN

The control should make it obvious which mode the conversation is currently in.

Example:

CHATBOT → "Switch to Human"

HUMAN → "Switch to Chatbot"

When clicked, immediately update the local mock state and all relevant UI.

The selected contact card, chat appearance, and message behavior should update immediately.

This is a frontend simulation only. There is no real backend yet.

---

# MESSAGES

Use simple, clean WhatsApp-inspired message bubbles.

There are three message sender types:

1. CUSTOMER

2. CHATBOT

3. HUMAN

Do not over-design the bubbles.

They should feel familiar and compact, similar to WhatsApp.

---

# MESSAGE ALIGNMENT

Customer messages should appear as incoming messages.

CHATBOT and HUMAN messages should appear as outgoing/staff-side messages.

Make the distinction immediately understandable through alignment and subtle styling.

---

# HUMAN MESSAGE DESIGN

Human messages should have a subtle yellow visual treatment consistent with HUMAN mode.

Do not make them extremely bright.

The yellow should feel like an accent rather than a warning.

---

# CHATBOT MESSAGE DESIGN

CHATBOT messages should be visually distinguishable from HUMAN messages, but should not use the yellow human treatment.

Use a subtle label or visual distinction such as:

CHATBOT

Do not use:

AI

---

# MESSAGE TIMESTAMPS

Every message should display a time in a WhatsApp-like format.

Examples:

10:42 AM

10:43 AM

Yesterday

Monday

For messages from today, display the local time.

For older messages, use an appropriate WhatsApp-like relative/date format.

The underlying mock message timestamps should be ISO/UTC timestamps.

Convert them to local display time in the frontend.

Do NOT hard-code local timestamps into the data model.

---

# WHATSAPP MESSAGE STATUS

Outgoing HUMAN and CHATBOT messages should support WhatsApp-style message status icons.

Examples:

✓

✓✓

✓✓

Support these states in the mock data:

* SENT

* DELIVERED

* READ

* FAILED

Use subtle icons similar to WhatsApp.

Customer messages do not need outgoing status icons.

The UI should be designed so that the eventual backend can replace the mock status with real WhatsApp status updates.

---

# MESSAGE INPUT

The message composer should contain:

* Text input

* Send button

* Enter-to-send behavior

* Disabled/loading state where appropriate

In HUMAN mode, sending a message should create a HUMAN message in the local mock conversation.

In CHATBOT mode, the UI should still be designed cleanly, but do not imply that the frontend itself is responsible for running the chatbot.

The backend will handle that later.

---

# REAL-TIME UI SIMULATION

Since there is no backend in this task, simulate real-time behavior locally where useful.

The architecture should make it easy for a future developer to replace this with WebSocket events.

The UI should react correctly when these events occur:

* New customer message

* New chatbot message

* New human message

* Mode changes

* Message becomes read

* Unread count changes

* WhatsApp status changes

* Conversation moves to the top

Do not implement an actual WebSocket connection.

Instead, keep the state/data layer clean and separated from the presentation layer.

---

# RESPONSIVE DESIGN

Desktop is the primary target.

The main conversation console should work especially well on:

* 1366×768

* 1440×900

* 1920×1080

Also provide sensible responsive behavior for smaller screens.

On mobile/tablet, the contact list and chat should be able to transition into a usable single-panel experience.

---

# DESIGN DIRECTION

The UI should feel:

* modern

* clean

* professional

* fast

* focused

* WhatsApp-inspired

* not like a generic SaaS dashboard

Avoid excessive cards, gradients, animations, decorative graphics, charts, and unnecessary UI.

Prioritize information density and usability.

The application is used by staff who may be monitoring many conversations.

---

# IMPORTANT UX PRIORITY

The contact list should make it immediately obvious:

1. Which customer was active most recently?

2. Which conversations have unread customer messages?

3. Which conversations are being handled by a human?

4. Which conversation is currently selected?

The chat should make it immediately obvious:

1. Who sent each message?

2. When was it sent?

3. What is the WhatsApp delivery status?

4. Is this conversation in HUMAN mode?

---

# MOCK DATA

Create realistic mock customers and conversations.

Include enough data to demonstrate:

* CHATBOT conversations

* HUMAN conversations

* unread conversations

* multiple unread messages

* customer messages

* chatbot messages

* human messages

* different WhatsApp delivery statuses

* conversations with recent activity

* conversations with older activity

Make the initial UI look populated and realistic.

---

# CODE QUALITY

Use reusable components.

Separate:

* layout

* contact list

* contact card

* chat

* message bubble

* message composer

* mode switch

* unread badge

* WhatsApp status indicator

* mock data/state

Do not tightly couple the UI components to the mock data implementation.

The eventual developer must be able to replace the mock data with real API/WebSocket data without rewriting the UI.

---

# FINAL REQUIREMENT

The final result should feel like a polished production frontend prototype for Transco.

Do not implement a backend.

Do not invent an API.

Do not invent WebSocket endpoints.

Do not connect to MongoDB.

Do not connect to Flowise.

Do not connect to WhatsApp.

Focus entirely on producing the functional, polished frontend UI and its local/mock interactions.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://transco-inbox.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/ee986cfb-63d5-4d35-a994-e604fd6cf8a1).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
