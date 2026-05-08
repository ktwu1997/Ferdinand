<!--
  Dashed inner divider. README §Borders: 1px dashed var(--rule). Decorative
  only so it carries `role="presentation"`.
-->
<script lang="ts">
    interface Props { class?: string; }
    let { class: klass = "" }: Props = $props();
</script>

<div class="divider {klass}" role="presentation"></div>

<style>
    .divider {
        height: 0;
        border-top: 1px dashed var(--rule);
        width: 100%;
    }
</style>
