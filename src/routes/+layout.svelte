<script lang="ts">
  import '../app.css';
  import { initSlots } from '$lib/layout-snippets';
  import * as Sidebar from '$lib/components/ui/sidebar/index.js';
  import AppSidebar from '$lib/components/app-sidebar.svelte';
  import Header from '$lib/components/layout/header.svelte';
  let { children } = $props();
  const slots = initSlots();
</script>

<!-- 먼저 페이지에서 슬롯 정보 초기화 -->
{@render children()}

<!-- 실제 레이아웃 구조 -->
<div class="flex h-screen bg-gray-100">
    <Sidebar.Provider>
        <AppSidebar />
        <main>
            <Header />
            {@render slots.children?.()}
        </main>
    </Sidebar.Provider>
</div>