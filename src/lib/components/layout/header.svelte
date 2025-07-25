<script lang="ts">
  import * as Sidebar from '$lib/components/ui/sidebar/index.js';
  import * as Breadcrumb from '$lib/components/ui/breadcrumb/index.js';
  import * as Avatar from '$lib/components/ui/avatar/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import UserIcon from '@lucide/svelte/icons/user';

  interface TriggerSnippetProps { props: Record<string, unknown>; }
  const crumbs = ['Dashboard', 'Reports'];
</script>

<header class="flex items-center justify-between h-16 px-4 border-b">
    <div class="flex items-center gap-4">
        <Sidebar.Trigger class="p-2 rounded hover:bg-muted" />
        <Breadcrumb.Root>
            <Breadcrumb.List>
                {#each crumbs as crumb, i}
                    <Breadcrumb.Item>
                        {#if i < crumbs.length - 1}
                            <Breadcrumb.Link href="#">{crumb}</Breadcrumb.Link>
                        {:else}
                            <Breadcrumb.Page>{crumb}</Breadcrumb.Page>
                        {/if}
                    </Breadcrumb.Item>
                    {#if i < crumbs.length - 1}
                        <Breadcrumb.Separator />
                    {/if}
                {/each}
            </Breadcrumb.List>
        </Breadcrumb.Root>
    </div>

    <div class="flex items-center space-x-4">
        <DropdownMenu.Root>
            <DropdownMenu.Trigger>
                {#snippet child({ props }: TriggerSnippetProps)}
                    <Button {...props} variant="outline">Open menu</Button>
                {/snippet}
            </DropdownMenu.Trigger>

            <DropdownMenu.Content side="bottom" align="end">
                <DropdownMenu.Label>Menu</DropdownMenu.Label>
                <DropdownMenu.Group>
                    <DropdownMenu.Item>Profile</DropdownMenu.Item>
                    <DropdownMenu.Item>Settings</DropdownMenu.Item>
                </DropdownMenu.Group>
                <DropdownMenu.Separator />
                <DropdownMenu.Item>Sign out</DropdownMenu.Item>
            </DropdownMenu.Content>
        </DropdownMenu.Root>

        <Avatar.Root class="cursor-pointer">
            <Avatar.Image src="/avatar.png" alt="User" />
            <Avatar.Fallback>User</Avatar.Fallback>
        </Avatar.Root>
    </div>
</header>
