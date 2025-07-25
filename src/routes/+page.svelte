<script lang="ts">
  import { setSlots } from '$lib/layout-snippets';
  setSlots({ sidebar, header, children });
  import AppSidebar from '$lib/components/app-sidebar.svelte';
  import Header from '$lib/components/layout/header.svelte';
  import * as Card from "$ui/card";
</script>
{#snippet sidebar()}
    <AppSidebar /> <!-- sidebar 자체를 snippet으로 전달 가능 -->
{/snippet}

{#snippet header()}
    <Header /> <!-- 헤더 컴포넌트 snippet 전달 -->
{/snippet}

{#snippet children()}
    <!-- 실제 페이지 컨텐츠 -->
    <div class="grid grid-cols-3 gap-4">
        {#each Array(3) as _, i}
            <Card.Root>
                <Card.Title>Card {i + 1}</Card.Title>
                <Card.Content>Example content.</Card.Content>
            </Card.Root>
        {/each}
    </div>
{/snippet}
