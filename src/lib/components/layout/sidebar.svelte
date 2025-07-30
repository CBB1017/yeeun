<script lang="ts">
  import * as Sidebar from '$ui/sidebar';
  import HomeIcon from '@lucide/svelte/icons/home';
  import SettingsIcon from '@lucide/svelte/icons/settings';
  import { DockIcon } from "@lucide/svelte";

  const items = [
    { title: 'Home', url: '/', icon: HomeIcon },
    { title: 'Settings', url: '/settings', icon: SettingsIcon },
    { title: 'Excel', url: '/excel', icon: DockIcon }
  ];
</script>

<Sidebar.Root side="left" variant="sidebar" collapsible="icon">
    <Sidebar.Header class="px-4 py-6 text-lg font-bold">MyApp</Sidebar.Header>
    <Sidebar.Content>
        <Sidebar.Group>
            <Sidebar.GroupContent>
                <Sidebar.Menu>
                    {#each items as item}
                        <Sidebar.MenuItem>
                            <Sidebar.MenuButton>
                                {#snippet child({ props })}
                                    <a href={item.url} {...props} class="flex items-center gap-2">
                                        <item.icon />
                                        <span>{item.title}</span>
                                    </a>
                                {/snippet}
                            </Sidebar.MenuButton>
                        </Sidebar.MenuItem>
                    {/each}
                </Sidebar.Menu>
            </Sidebar.GroupContent>
        </Sidebar.Group>
    </Sidebar.Content>
    <Sidebar.Footer class="px-4 py-4">
        <!-- 여기에 하단 메뉴 등 추가 가능 -->
    </Sidebar.Footer>
</Sidebar.Root>
