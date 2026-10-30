import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { fmt, parseAmount, price0In1, shortAddr } from './lib/chain';
import { Badge, Card } from './components/UI';

test('数量格式化与解析', () => {
  expect(fmt(10n ** 18n, 2)).toBe('1');
  expect(fmt(15n * 10n ** 17n, 3)).toBe('1.5');
  expect(fmt(1234567n * 10n ** 18n, 0)).toBe('1,234,567');
  expect(parseAmount('2.5')).toBe(25n * 10n ** 17n);
  expect(parseAmount('')).toBe(0n);
});

test('价格计算与地址缩写', () => {
  expect(price0In1({ reserve0: 1000n, reserve1: 800n })).toBeCloseTo(0.8);
  expect(shortAddr('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')).toBe('0xf39F…2266');
});

test('通用卡片组件可以正常渲染', () => {
  render(
    <Card title="测试卡片" subtitle="副标题">
      <Badge>标签</Badge>
    </Card>
  );
  expect(screen.getByText('测试卡片')).toBeInTheDocument();
  expect(screen.getByText('标签')).toBeInTheDocument();
});
