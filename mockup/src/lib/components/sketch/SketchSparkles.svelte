<script lang="ts">
    interface Props { class?: string; }
    let { class: klass = "" }: Props = $props();
</script>

<svg
    viewBox="0 0 60 40"
    width="60"
    height="40"
    class="sketch {klass}"
    aria-hidden="true"
>
    <path d="M10 20 L 10 30 M5 25 L 15 25" />
    <path d="M40 10 L 40 18 M36 14 L 44 14" class="thin" />
    <path d="M50 28 L 50 34 M47 31 L 53 31" class="thin" />
</svg>
