<script lang="ts">
  import '../app.css';
  import AppSidebar from '$lib/components/app-sidebar.svelte';
  import type { LayoutProps } from './$types';
  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import SiteHeader from "$lib/components/site-header.svelte";

  let { children }: LayoutProps = $props();
</script>

<!-- 실제 레이아웃 구조 -->

<Sidebar.Provider
        style="--sidebar-width: calc(var(--spacing) * 72); --header-height: calc(var(--spacing) * 12);"
>
    <AppSidebar variant="inset"/>
    <main class="flex-1 min-h-0 min-w-0 flex flex-col">

        <Sidebar.Inset>
            <SiteHeader/>
            {@render children()}
        </Sidebar.Inset>
    </main>

</Sidebar.Provider>
