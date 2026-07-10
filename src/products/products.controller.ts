import { Controller, Get, Param, Query } from '@nestjs/common';
import { ProductQueryDto } from './dto/product-query.dto';
import { ProductsService } from './products.service';

@Controller('api/products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  listProducts(@Query() query: ProductQueryDto) {
    return this.productsService.listProducts(query);
  }

  @Get(':slug')
  getProduct(@Param('slug') slug: string) {
    return this.productsService.getProduct(slug);
  }
}
