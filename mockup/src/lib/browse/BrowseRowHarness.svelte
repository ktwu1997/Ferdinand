<script lang="ts">
    // Test-only harness for BrowseRow, mirroring CardFaceHarness: wrap the
    // reactive-under-test props in `$state(untrack(() => prop))` so the spec
    // captures a one-time snapshot at mount and drives further mutation via
    // the exported setters. Without `untrack`, svelte 5 fires
    // `state_referenced_locally` (https://svelte.dev/e/state_referenced_locally).
    //
    // NOTE: the prop is named `cardState` (not `state`) and forwarded to
    // BrowseRow as `state={cardState}`. A local binding called `state`
    // collides with the `$state` rune — svelte treats `$state(...)` as a
    // store subscription on the local `state` and emits store_rune_conflict
    // (https://svelte.dev/e/store_rune_conflict), turning the subsequent
    // `$state(...)` reactive declarations into plain assignments.
    import { untrack } from "svelte";

    import BrowseRow from "./BrowseRow.svelte";

    interface Props {
        id: string;
        initialFrontHtml: string;
        initialBackHtml: string;
        deckName: string;
        deckEmoji: string;
        initialTags: string[];
        due: string;
        cardState: string;
        initialSelected: boolean;
        onSelect: () => void;
    }

    let {
        id,
        initialFrontHtml,
        initialBackHtml,
        deckName,
        deckEmoji,
        initialTags,
        due,
        cardState,
        initialSelected,
        onSelect,
    }: Props = $props();

    let frontHtml = $state<string>(untrack(() => initialFrontHtml));
    let backHtml = $state<string>(untrack(() => initialBackHtml));
    let tags = $state<string[]>(untrack(() => initialTags));
    let selected = $state<boolean>(untrack(() => initialSelected));

    export function setSelected(value: boolean): void {
        selected = value;
    }

    export function setTags(value: string[]): void {
        tags = value;
    }

    export function setFrontHtml(value: string): void {
        frontHtml = value;
    }

    export function setBackHtml(value: string): void {
        backHtml = value;
    }
</script>

<BrowseRow
    {id}
    {frontHtml}
    {backHtml}
    {deckName}
    {deckEmoji}
    {tags}
    {due}
    state={cardState}
    {selected}
    {onSelect}
/>
