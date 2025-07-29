<script lang="ts">
  import '../app.css';
  import * as Sidebar from '$lib/components/ui/sidebar/index.js';
  import AppSidebar from '$lib/components/app-sidebar.svelte';
  import Header from '$lib/components/layout/header.svelte';
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();
</script>

<!-- 먼저 페이지에서 슬롯 정보 초기화 -->


<!-- 실제 레이아웃 구조 -->
<div class="flex h-screen w-screen">
    <Sidebar.Provider>
        <AppSidebar/>

        <main class="flex-1 min-h-0 min-w-0 flex flex-col">
            <Header/>
            <div class="flex-1 min-h-0 min-w-0 overflow-auto">
                {@render children()}
            </div>
        </main>
    </Sidebar.Provider>
</div>
