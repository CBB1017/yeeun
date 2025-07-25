<h1>Welcome to SvelteKit</h1>
<p>Visit <a href="https://svelte.dev/docs/kit">svelte.dev/docs/kit</a> to read the documentation</p>
<script lang="ts">
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Label } from '$lib/components/ui/label';
  import { Input } from '$lib/components/ui/input';
</script>

<Card.Root class="max-w-sm mx-auto mt-8">
    <Card.Header>
        <Card.Title>Login</Card.Title>
        <Card.Description>Please enter your credentials.</Card.Description>
    </Card.Header>
    <Card.Content>
        <Label for="email">Email</Label>
        <Input id="email" type="email" required />
        <Label for="password">Password</Label>
        <Input id="password" type="password" required />
    </Card.Content>
    <Card.Footer>
        <Button class="w-full">Sign In</Button>
    </Card.Footer>
</Card.Root>