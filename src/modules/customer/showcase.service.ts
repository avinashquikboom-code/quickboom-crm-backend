import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface ShowcaseProductDto {
  id: string;
  name: string;
  title: string;
  imageUrl: string;
  thumbnailUrl: string;
  originalPrice: number;
  sellingPrice: number;
  currency: string;
}

export interface FeaturedInfluencerDto {
  id: string;
  creatorName: string;
  avatarUrl: string;
  mediaUrl: string;
  thumbnailUrl: string;
  followersCount: string;
  followers: number;
  tag?: string;
}

export interface ProductShowcaseResponse {
  id: string;
  categoryTitle: string;
  totalProductCount: number;
  viewAllUrl: string;
  featuredInfluencer: FeaturedInfluencerDto;
  products: ShowcaseProductDto[];
}

@Injectable()
export class ShowcaseService {
  private readonly logger = new Logger(ShowcaseService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves showcase products for customer home screen.
   * Can query database products if present, or dynamically build the catalog showcase.
   */
  async getPinterestyTopsShowcase(customerId?: any): Promise<ProductShowcaseResponse> {
    this.logger.log(`[SHOWCASE_REQUEST] Fetching Pinteresty Tops showcase for customerId: ${customerId}`);

    // If customer has created products in the database, we can mix or prefer them
    let dbProducts: any[] = [];
    try {
      const numCustomerId = customerId ? parseInt(String(customerId), 10) : undefined;
      if (numCustomerId && !isNaN(numCustomerId)) {
        dbProducts = await this.prisma.product.findMany({
          where: {
            customerId: numCustomerId,
            isActive: true,
            deletedAt: null,
          },
          take: 4,
          orderBy: { id: 'desc' },
        });
      }
    } catch (e) {
      this.logger.warn(`Could not query database products: ${e}`);
    }

    const defaultProducts: ShowcaseProductDto[] = [
      {
        id: 'prod_top_1',
        name: 'Crochet Floral Crop Top',
        title: 'Crochet Floral Crop Top',
        imageUrl: 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=600&q=80',
        thumbnailUrl: 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=600&q=80',
        originalPrice: 699,
        sellingPrice: 467,
        currency: '₹',
      },
      {
        id: 'prod_top_2',
        name: 'Pastel Ribbed Knit Top',
        title: 'Pastel Ribbed Knit Top',
        imageUrl: 'https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?auto=format&fit=crop&w=600&q=80',
        thumbnailUrl: 'https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?auto=format&fit=crop&w=600&q=80',
        originalPrice: 1399,
        sellingPrice: 243,
        currency: '₹',
      },
      {
        id: 'prod_top_3',
        name: 'Vintage Puff Sleeve Blouse',
        title: 'Vintage Puff Sleeve Blouse',
        imageUrl: 'https://images.unsplash.com/photo-1485230895905-ec40ba36b9bc?auto=format&fit=crop&w=600&q=80',
        thumbnailUrl: 'https://images.unsplash.com/photo-1485230895905-ec40ba36b9bc?auto=format&fit=crop&w=600&q=80',
        originalPrice: 999,
        sellingPrice: 380,
        currency: '₹',
      },
      {
        id: 'prod_top_4',
        name: 'Cottagecore Lace Peplum',
        title: 'Cottagecore Lace Peplum',
        imageUrl: 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=600&q=80',
        thumbnailUrl: 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=600&q=80',
        originalPrice: 3249,
        sellingPrice: 1819,
        currency: '₹',
      },
    ];

    // If database products exist, map them over default items
    const products: ShowcaseProductDto[] = dbProducts.length >= 4
      ? dbProducts.slice(0, 4).map((p, idx) => ({
          id: String(p.id),
          name: p.name,
          title: p.name,
          imageUrl: defaultProducts[idx % defaultProducts.length].imageUrl,
          thumbnailUrl: defaultProducts[idx % defaultProducts.length].thumbnailUrl,
          originalPrice: p.unitPrice ? Math.round(p.unitPrice * 1.4) : defaultProducts[idx].originalPrice,
          sellingPrice: p.unitPrice || defaultProducts[idx].sellingPrice,
          currency: p.currency === 'INR' ? '₹' : (p.currency || '₹'),
        }))
      : defaultProducts;

    const featuredInfluencer: FeaturedInfluencerDto = {
      id: 'inf_swaranjali',
      creatorName: 'Swaranjali__...',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
      mediaUrl: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=800&q=80',
      thumbnailUrl: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=800&q=80',
      followersCount: '413 followers',
      followers: 413,
      tag: 'Featured Creator',
    };

    return {
      id: 'showcase_pinteresty_tops',
      categoryTitle: 'Pinteresty Tops',
      totalProductCount: 47,
      viewAllUrl: '/catalog/pinteresty-tops',
      featuredInfluencer,
      products,
    };
  }
}
