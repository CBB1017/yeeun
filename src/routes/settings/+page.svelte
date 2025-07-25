<script lang="ts">
  import * as Card from "$ui/card";
</script>
<!--{#snippet sidebar()}
    <AppSidebar /> &lt;!&ndash; sidebar 자체를 snippet으로 전달 가능 &ndash;&gt;
{/snippet}

{#snippet header()}
    <Header /> &lt;!&ndash; 헤더 컴포넌트 snippet 전달 &ndash;&gt;
{/snippet}-->

<!-- {#snippet children()} -->
<!-- 실제 페이지 컨텐츠 -->
<div class="grid grid-cols-3 gap-4">
        <Card.Root>
            <Card.Title>Card </Card.Title>
            <Card.Content>Example content.</Card.Content>
        </Card.Root>
</div>
<!-- {/snippet} -->
