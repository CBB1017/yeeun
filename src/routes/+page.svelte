<script lang="ts">
  import { setSlots } from '$lib/layout-snippets';
  setSlots({ sidebar, header, children });
</script>

{#snippet sidebar()}
    <div class="space-y-4">
        <a href="/" class="block text-lg font-semibold hover:text-blue-600">Dashboard</a>
        <a href="/reports" class="block text-lg font-semibold hover:text-blue-600">Reports</a>
        <a href="/settings" class="block text-lg font-semibold hover:text-blue-600">Settings</a>
    </div>
{/snippet}

{#snippet header()}
    <div class="flex justify-between items-center w-full">
        <h1 class="text-2xl font-bold">Welcome to Dashboard</h1>
        <button class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
            New Report
        </button>
    </div>
{/snippet}

{#snippet children()}
    <div class="grid grid-cols-3 gap-6">
        {#each Array(3) as _, i}
            <div class="bg-white p-4 rounded shadow">
                <h2 class="text-xl font-semibold mb-2">Card {i + 1}</h2>
                <p class="text-gray-600">Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
            </div>
        {/each}
    </div>
{/snippet}
